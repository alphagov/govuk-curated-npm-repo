#!/usr/bin/env sh
set -e

# Set npm cache to a directory the verdaccio user owns
export npm_config_cache="/verdaccio/.npm-cache"
mkdir -p "$npm_config_cache"

# Check if we're in development mode (plugin directory is mounted)
if [ "$NODE_ENV" = "development" ] && [ -d "/verdaccio/plugins/verdaccio-approval-plugin" ]; then
    echo "Development mode detected - installing plugin dependencies"
    cd /verdaccio/plugins/verdaccio-approval-plugin
    npm install
	# ln -sf /verdaccio/plugins/verdaccio-approval-plugin /app/node_modules/verdaccio-approval-plugin

	cd /verdaccio/plugins/verdaccio-quarantine-plugin
	npm install
	# ln -sf /verdaccio/plugins/verdaccio-quarantine-plugin /app/node_modules/verdaccio-quarantine-plugin

	# Create symlinks in /app/node_modules
    cd /app
    rm -rf node_modules/verdaccio-approval-plugin node_modules/verdaccio-quarantine-plugin
    ln -sf /verdaccio/plugins/verdaccio-approval-plugin node_modules/verdaccio-approval-plugin
    ln -sf /verdaccio/plugins/verdaccio-quarantine-plugin node_modules/verdaccio-quarantine-plugin

	# Create bin symlink in a verdaccio-owned directory
	mkdir -p /verdaccio/bin
	ln -sf /verdaccio/plugins/verdaccio-quarantine-plugin/src/scanner.js /verdaccio/bin/scanner
	chmod +x /verdaccio/plugins/verdaccio-quarantine-plugin/src/scanner.js

	# Add to PATH
	export PATH="/verdaccio/bin:$PATH"
   	
    # Verify the symlinks
    echo "Verifying symlinks:"
    ls -la node_modules/ | grep verdaccio
	
    echo "Plugin setup complete. Starting verdaccio in development mode with nodemon"
    cd /app
    exec npm run dev
else
    echo "Production mode - starting verdaccio directly"
    exec verdaccio
fi
