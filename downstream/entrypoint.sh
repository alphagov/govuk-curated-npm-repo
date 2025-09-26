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
	ln -sf /verdaccio/plugins/verdaccio-approval-plugin /app/node_modules/verdaccio-approval-plugin
    
    echo "Plugin setup complete. Starting verdaccio in development mode with nodemon"
    cd /app
    exec npm run dev
else
    echo "Production mode - starting verdaccio directly"
    exec verdaccio
fi
