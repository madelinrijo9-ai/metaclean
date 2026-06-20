#!/bin/bash

# Exit on error
set -e

# Clear screen for a clean terminal presentation
clear

echo "=========================================================="
echo "      MetaClean - Local Web Server Setup & Runner"
echo "=========================================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed."
    echo "Please download and install Node.js from: https://nodejs.org/"
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

echo "✓ Node.js detected: $(node -v)"

# Determine package manager
if command -v pnpm &> /dev/null; then
    PM="pnpm"
    echo "✓ pnpm package manager detected"
else
    echo "⚠️  pnpm not found globally. Using 'npx pnpm' fallback..."
    PM="npx pnpm"
fi

echo ""
echo "📦 Installing dependencies (this may take a few moments)..."
echo "----------------------------------------------------------"
$PM install
echo "----------------------------------------------------------"
echo "✓ Dependencies installed successfully!"
echo ""

echo "🚀 Starting the MetaClean local dev server..."
echo "----------------------------------------------------------"
$PM dev
