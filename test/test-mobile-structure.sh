#!/bin/bash

echo "========================================"
echo "Mobile Layout Structure Tests"
echo "========================================"
echo ""

# Test 1: Check mobile overflow menu exists
echo "🔍 Testing HTML Structure"
echo ""

# Fetch the page
HTML=$(curl -s http://localhost:3000)

# Test mobile overflow menu structure
if echo "$HTML" | grep -q 'class="mobile-overflow-menu"'; then
    echo "   ✅ Mobile overflow menu container exists"
else
    echo "   ❌ Mobile overflow menu container missing"
fi

if echo "$HTML" | grep -q 'id="mobileThemeToggle"'; then
    echo "   ✅ Mobile theme toggle button exists"
else
    echo "   ❌ Mobile theme toggle button missing"
fi

if echo "$HTML" | grep -q 'id="mobileSettingsBtn"'; then
    echo "   ✅ Mobile settings button exists"
else
    echo "   ❌ Mobile settings button missing"
fi

if echo "$HTML" | grep -q 'id="mobileBookmarkBtn"'; then
    echo "   ✅ Mobile bookmark button exists"
else
    echo "   ❌ Mobile bookmark button missing"
fi

# Test mobile tabs dropdown structure
if echo "$HTML" | grep -q 'class="mobile-tabs-dropdown"'; then
    echo "   ✅ Mobile tabs dropdown container exists"
else
    echo "   ❌ Mobile tabs dropdown container missing"
fi

if echo "$HTML" | grep -q 'id="mobileTabsToggle"'; then
    echo "   ✅ Mobile tabs toggle button exists"
else
    echo "   ❌ Mobile tabs toggle button missing"
fi

if echo "$HTML" | grep -q 'id="mobileTabsMenu"'; then
    echo "   ✅ Mobile tabs menu exists"
else
    echo "   ❌ Mobile tabs menu missing"
fi

# Test desktop-only controls
if echo "$HTML" | grep -q 'class="desktop-only"'; then
    echo "   ✅ Desktop-only controls container exists"
else
    echo "   ❌ Desktop-only controls container missing"
fi

# Test SSH and SFTP buttons
if echo "$HTML" | grep -q 'id="newSshBtn"'; then
    echo "   ✅ SSH button exists"
else
    echo "   ❌ SSH button missing"
fi

if echo "$HTML" | grep -q 'id="newSftpBtn"'; then
    echo "   ✅ SFTP button exists"
else
    echo "   ❌ SFTP button missing"
fi

# Test CSS file for responsive styles
echo ""
echo "🎨 Testing CSS Responsive Styles"
echo ""

CSS=$(cat /home/code/projects/project/sshift/public/css/style.css)

# Check for mobile media query
if echo "$CSS" | grep -q '@media.*max-width.*768px'; then
    echo "   ✅ Mobile media query exists (768px breakpoint)"
else
    echo "   ❌ Mobile media query missing"
fi

# Check for desktop-only hiding on mobile (more precise grep)
if echo "$CSS" | grep -A 50 '@media.*max-width.*768px' | grep -q 'desktop-only'; then
    echo "   ✅ Desktop-only controls hidden on mobile"
else
    echo "   ❌ Desktop-only controls not hidden on mobile"
fi

# Check for mobile overflow menu showing on mobile
if echo "$CSS" | grep -A 50 '@media.*max-width.*768px' | grep -q 'mobile-overflow-menu'; then
    echo "   ✅ Mobile overflow menu shown on mobile"
else
    echo "   ❌ Mobile overflow menu not shown on mobile"
fi

# Check for desktop tabs hiding on mobile
if echo "$CSS" | grep -A 50 '@media.*max-width.*768px' | grep -q '\.tabs'; then
    echo "   ✅ Desktop tabs hidden on mobile"
else
    echo "   ❌ Desktop tabs not hidden on mobile"
fi

# Check for mobile tabs dropdown showing on mobile
if echo "$CSS" | grep -A 50 '@media.*max-width.*768px' | grep -q 'mobile-tabs-dropdown'; then
    echo "   ✅ Mobile tabs dropdown shown on mobile"
else
    echo "   ❌ Mobile tabs dropdown not shown on mobile"
fi

# Test JavaScript file for mobile event handlers
echo ""
echo "⚙️  Testing JavaScript Event Handlers"
echo ""

JS=$(cat /home/code/projects/project/sshift/public/js/app.js)

# Check for setupMobileOverflowMenu method
if echo "$JS" | grep -q 'setupMobileOverflowMenu()'; then
    echo "   ✅ setupMobileOverflowMenu method exists"
else
    echo "   ❌ setupMobileOverflowMenu method missing"
fi

# Check for setupMobileTabsDropdown method
if echo "$JS" | grep -q 'setupMobileTabsDropdown()'; then
    echo "   ✅ setupMobileTabsDropdown method exists"
else
    echo "   ❌ setupMobileTabsDropdown method missing"
fi

# Check for updateMobileTabsDropdown method
if echo "$JS" | grep -q 'updateMobileTabsDropdown()'; then
    echo "   ✅ updateMobileTabsDropdown method exists"
else
    echo "   ❌ updateMobileTabsDropdown method missing"
fi

# Check for mobile bookmark button handler
if echo "$JS" | grep -q "mobileBookmarkBtn.*addEventListener"; then
    echo "   ✅ Mobile bookmark button event handler exists"
else
    echo "   ❌ Mobile bookmark button event handler missing"
fi

# Check for mobile settings button handler
if echo "$JS" | grep -q "mobileSettingsBtn.*addEventListener"; then
    echo "   ✅ Mobile settings button event handler exists"
else
    echo "   ❌ Mobile settings button event handler missing"
fi

# Check for mobile theme toggle handler
if echo "$JS" | grep -q "mobileThemeToggle.*addEventListener"; then
    echo "   ✅ Mobile theme toggle event handler exists"
else
    echo "   ❌ Mobile theme toggle event handler missing"
fi

echo ""
echo "========================================"
echo "✅ Mobile layout structure tests complete"
echo "========================================"