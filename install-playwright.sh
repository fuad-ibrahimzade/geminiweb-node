#!/bin/bash
# Cross-platform Playwright installation script
# Works on NixOS, Ubuntu, Debian, Windows (WSL/Git Bash), and macOS

set -e

echo "Detecting OS for Playwright browser installation..."

OS_TYPE=$(uname -s)

# Check for NixOS
if [ -f /etc/nixos/nixexprs ] || [ -f /etc/NIXOS ]; then
    echo "Detected NixOS"
    echo ""
    echo "On NixOS, you have two options:"
    echo ""
    echo "Option 1: Use Firefox (RECOMMENDED - works without system dependencies)"
    echo "  npx playwright install firefox"
    echo ""
    echo "Option 2: Use Chromium (requires system libraries)"
    echo "  npx playwright install chromium"
    echo ""
    echo "Note: If Chromium fails with 'libnspr4.so' errors, use Firefox instead."
    echo ""
    npx playwright install firefox chromium || true
elif [ "$OS_TYPE" = "Linux" ]; then
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|linuxmint|pop)
                echo "Detected $ID - installing with system deps"
                npx playwright install chromium --with-deps
                npx playwright install firefox || true
                ;;
            *)
                echo "Detected Linux ($ID) - attempting install"
                npx playwright install chromium --with-deps || npx playwright install chromium
                npx playwright install firefox || true
                ;;
        esac
    fi
elif [ "$OS_TYPE" = "Darwin" ]; then
    echo "Detected macOS"
    npx playwright install chromium firefox
elif [[ "$OS_TYPE" =~ MINGW|MSYS|CYGWIN ]]; then
    echo "Detected Windows"
    npx playwright install chromium firefox
else
    echo "Unknown OS: $OS_TYPE"
    npx playwright install chromium firefox
fi

echo "Playwright installation complete!"
echo ""
echo "Usage:"
echo "  npm run login               # Use Chromium (default)"
echo "  npm run login -- --browser firefox  # Use Firefox (recommended on NixOS)"
echo "  npm run serve -- --browser firefox  # Use Firefox for API server"
