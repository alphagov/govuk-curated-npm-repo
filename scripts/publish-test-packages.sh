#!/bin/bash

# publish-test-packages.sh
set -e

REGISTRY_URL="http://verdaccio-upstream:4873"
USERNAME="testuser"
PASSWORD="testpass123"
EMAIL="test@example.com"

echo "Setting up npm configuration for upstream registry..."
npm set registry $REGISTRY_URL

# Function to check if user exists by trying to get user info
check_user_exists() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X GET \
        "$REGISTRY_URL/-/user/org.couchdb.user:$USERNAME")
    
    if [ "$response" = "200" ]; then
        return 0  # User exists
    else
        return 1  # User doesn't exist
    fi
}

# Function to create user and get auth token
create_user_and_login() {
    echo "Creating test user account..."
    
    # Create user
    local create_response=$(curl -s \
        -X PUT \
        "$REGISTRY_URL/-/user/org.couchdb.user:$USERNAME" \
        -H 'Content-Type: application/json' \
        -d '{
            "name": "'$USERNAME'",
            "password": "'$PASSWORD'",
            "email": "'$EMAIL'",
            "type": "user",
            "roles": [],
            "date": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
        }')
    
    echo "User creation response: $create_response"
    
    # Extract token from response if available
    local token=$(echo "$create_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$token" ]; then
        echo "Got token from user creation: $token"
        echo "//$REGISTRY_URL/:_authToken=$token" > ~/.npmrc
        echo "registry=$REGISTRY_URL" >> ~/.npmrc
    else
        echo "No token in creation response, trying login..."
        login_user
    fi
}

# Function to login user and get auth token
login_user() {
    echo "Setting up authentication..."
    
    # Set up basic auth directly since it works reliably
    local auth_string=$(echo -n "$USERNAME:$PASSWORD" | base64)
    cat > ~/.npmrc << EOF
//${REGISTRY_URL#http://}/:_auth=$auth_string
//${REGISTRY_URL#http://}/:always-auth=true
registry=$REGISTRY_URL
email=$EMAIL
EOF
    
    echo "Set up basic auth in ~/.npmrc"
    
    # Test the auth by trying to get user info
    if npm whoami --registry="$REGISTRY_URL" >/dev/null 2>&1; then
        echo "✓ Authentication successful"
        return 0
    else
        echo "✗ Authentication failed"
        return 1
    fi
}

# Function to check if package exists
check_package_exists() {
    local package_name=$1
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X GET \
        "$REGISTRY_URL/$package_name")
    
    if [ "$response" = "200" ]; then
        return 0  # Package exists
    else
        return 1  # Package doesn't exist
    fi
}

# Function to get package version from package.json
get_package_info() {
    local package_dir=$1
    if [ -f "$package_dir/package.json" ]; then
        local name=$(node -p "require('$package_dir/package.json').name" 2>/dev/null || echo "")
        local version=$(node -p "require('$package_dir/package.json').version" 2>/dev/null || echo "")
        echo "$name:$version"
    else
        echo ":"
    fi
}

# Function to check if specific package version exists
check_package_version_exists() {
    local package_name=$1
    local version=$2
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X GET \
        "$REGISTRY_URL/$package_name/$version")
    
    if [ "$response" = "200" ]; then
        return 0  # Version exists
    else
        return 1  # Version doesn't exist
    fi
}

# Function to publish package if not exists
publish_package() {
    local package_dir=$1
    local package_desc=$2
    
    if [ ! -d "$package_dir" ]; then
        echo "Warning: Package directory $package_dir not found, skipping..."
        return 0
    fi
    
    cd "$package_dir"
    
    # Get package info
    local package_info=$(get_package_info ".")
    local package_name=$(echo "$package_info" | cut -d':' -f1)
    local package_version=$(echo "$package_info" | cut -d':' -f2)
    
    if [ -z "$package_name" ] || [ -z "$package_version" ]; then
        echo "Error: Could not read package name/version from $package_dir/package.json"
        return 1
    fi
    
    echo "Checking $package_desc ($package_name@$package_version)..."
    
    if check_package_version_exists "$package_name" "$package_version"; then
        echo "✓ Package $package_name@$package_version already exists, skipping publish"
        return 0
    fi
    
    echo "Publishing $package_desc ($package_name@$package_version)..."
    if npm publish --registry "$REGISTRY_URL"; then
        echo "✓ Successfully published $package_name@$package_version"
    else
        echo "✗ Failed to publish $package_name@$package_version"
        return 1
    fi
}

# Main execution
echo "=== Verdaccio Test Package Publisher ==="

# Check if user exists, create if not
if check_user_exists; then
    echo "User $USERNAME already exists, logging in..."
    login_user
else
    echo "User $USERNAME doesn't exist, creating..."
    create_user_and_login
fi

echo ""
echo "=== Publishing Test Packages ==="

# List of packages to publish (directory:description)
PACKAGES="/app/test-packages/suspicious-test-package:suspicious test package
/app/test-packages/network-test-package:network test package
/app/test-packages/clean-test-package:clean test package"

# Function to check all packages exist
check_all_packages_exist() {
    echo "$PACKAGES" | while IFS= read -r package_info; do
        [ -z "$package_info" ] && continue
        package_dir=$(echo "$package_info" | cut -d':' -f1)
        if [ -d "$package_dir" ]; then
            pkg_info=$(get_package_info "$package_dir")
            pkg_name=$(echo "$pkg_info" | cut -d':' -f1)
            pkg_version=$(echo "$pkg_info" | cut -d':' -f2)
            
            if [ -n "$pkg_name" ] && [ -n "$pkg_version" ]; then
                if ! check_package_version_exists "$pkg_name" "$pkg_version"; then
                    return 1  # At least one doesn't exist
                fi
            else
                return 1  # Can't read package info
            fi
        else
            echo "Warning: Package directory $package_dir not found"
            return 1
        fi
    done
    return 0  # All exist
}

# Check if ALL packages already exist
if check_all_packages_exist; then
    echo "✓ All test packages already exist with current versions, nothing to publish!"
    echo "   Use 'npm version patch' in package dirs and re-run to publish new versions."
    exit 0
fi

# Publish packages that don't exist
echo "$PACKAGES" | while IFS= read -r package_info; do
    [ -z "$package_info" ] && continue
    package_dir=$(echo "$package_info" | cut -d':' -f1)
    package_desc=$(echo "$package_info" | cut -d':' -f2-)
    
    publish_package "$package_dir" "$package_desc"
    echo ""
done

echo "=== Summary ==="
echo "✓ All test packages processed successfully!"
echo "✓ Registry: $REGISTRY_URL"
echo "✓ User: $USERNAME"

# Keep container running so we can manually test
echo ""
echo "Test publisher completed. Container will stay running for debugging..."
tail -f /dev/null
