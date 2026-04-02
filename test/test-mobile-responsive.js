const puppeteer = require('puppeteer');

async function testMobileLayout() {
  console.log('========================================');
  console.log('Mobile Layout Tests');
  console.log('========================================\n');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  let allPassed = true;
  
  try {
    // Test desktop view
    console.log('🖥️  Testing Desktop View (1920x1080)');
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1920, height: 1080 });
    await desktopPage.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    
    // Desktop-only controls should be visible
    const desktopOnlyVisible = await desktopPage.evaluate(() => {
      const el = document.querySelector('.desktop-only');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });
    
    if (desktopOnlyVisible) {
      console.log('   ✅ Desktop-only controls visible');
    } else {
      console.log('   ❌ Desktop-only controls not visible');
      allPassed = false;
    }
    
    // Mobile overflow menu should be hidden
    const mobileOverflowHidden = await desktopPage.evaluate(() => {
      const el = document.querySelector('.mobile-overflow-menu');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    
    if (mobileOverflowHidden) {
      console.log('   ✅ Mobile overflow menu hidden');
    } else {
      console.log('   ❌ Mobile overflow menu not hidden');
      allPassed = false;
    }
    
    // Desktop tabs should be visible
    const desktopTabsVisible = await desktopPage.evaluate(() => {
      const el = document.querySelector('.tabs');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });
    
    if (desktopTabsVisible) {
      console.log('   ✅ Desktop tabs visible');
    } else {
      console.log('   ❌ Desktop tabs not visible');
      allPassed = false;
    }
    
    // Mobile tabs dropdown should be hidden
    const mobileTabsHidden = await desktopPage.evaluate(() => {
      const el = document.querySelector('.mobile-tabs-dropdown');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    
    if (mobileTabsHidden) {
      console.log('   ✅ Mobile tabs dropdown hidden');
    } else {
      console.log('   ❌ Mobile tabs dropdown not hidden');
      allPassed = false;
    }
    
    // SSH and SFTP buttons should exist
    const sshBtnExists = await desktopPage.evaluate(() => {
      return !!document.querySelector('#newSshBtn');
    });
    
    const sftpBtnExists = await desktopPage.evaluate(() => {
      return !!document.querySelector('#newSftpBtn');
    });
    
    if (sshBtnExists) {
      console.log('   ✅ SSH button exists');
    } else {
      console.log('   ❌ SSH button missing');
      allPassed = false;
    }
    
    if (sftpBtnExists) {
      console.log('   ✅ SFTP button exists');
    } else {
      console.log('   ❌ SFTP button missing');
      allPassed = false;
    }
    
    await desktopPage.close();
    
    // Test mobile view
    console.log('\n📱 Testing Mobile View (375x667)');
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 375, height: 667 });
    await mobilePage.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    
    // Desktop-only controls should be hidden
    const desktopOnlyHidden = await mobilePage.evaluate(() => {
      const el = document.querySelector('.desktop-only');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    
    if (desktopOnlyHidden) {
      console.log('   ✅ Desktop-only controls hidden');
    } else {
      console.log('   ❌ Desktop-only controls not hidden');
      allPassed = false;
    }
    
    // Mobile overflow menu should be visible
    const mobileOverflowVisible = await mobilePage.evaluate(() => {
      const el = document.querySelector('.mobile-overflow-menu');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });
    
    if (mobileOverflowVisible) {
      console.log('   ✅ Mobile overflow menu visible');
    } else {
      console.log('   ❌ Mobile overflow menu not visible');
      allPassed = false;
    }
    
    // Mobile overflow menu should have correct buttons
    const themeToggleExists = await mobilePage.evaluate(() => {
      return !!document.querySelector('#mobileThemeToggle');
    });
    
    const settingsBtnExists = await mobilePage.evaluate(() => {
      return !!document.querySelector('#mobileSettingsBtn');
    });
    
    const bookmarkBtnExists = await mobilePage.evaluate(() => {
      return !!document.querySelector('#mobileBookmarkBtn');
    });
    
    if (themeToggleExists) {
      console.log('   ✅ Mobile theme toggle exists');
    } else {
      console.log('   ❌ Mobile theme toggle missing');
      allPassed = false;
    }
    
    if (settingsBtnExists) {
      console.log('   ✅ Mobile settings button exists');
    } else {
      console.log('   ❌ Mobile settings button missing');
      allPassed = false;
    }
    
    if (bookmarkBtnExists) {
      console.log('   ✅ Mobile bookmark button exists');
    } else {
      console.log('   ❌ Mobile bookmark button missing');
      allPassed = false;
    }
    
    // Desktop tabs should be hidden
    const desktopTabsHidden = await mobilePage.evaluate(() => {
      const el = document.querySelector('.tabs');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    
    if (desktopTabsHidden) {
      console.log('   ✅ Desktop tabs hidden');
    } else {
      console.log('   ❌ Desktop tabs not hidden');
      allPassed = false;
    }
    
    // Mobile tabs dropdown should be visible
    const mobileTabsVisible = await mobilePage.evaluate(() => {
      const el = document.querySelector('.mobile-tabs-dropdown');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });
    
    if (mobileTabsVisible) {
      console.log('   ✅ Mobile tabs dropdown visible');
    } else {
      console.log('   ❌ Mobile tabs dropdown not visible');
      allPassed = false;
    }
    
    // SSH and SFTP buttons should still exist
    const mobileSshBtnExists = await mobilePage.evaluate(() => {
      return !!document.querySelector('#newSshBtn');
    });
    
    const mobileSftpBtnExists = await mobilePage.evaluate(() => {
      return !!document.querySelector('#newSftpBtn');
    });
    
    if (mobileSshBtnExists) {
      console.log('   ✅ SSH button exists on mobile');
    } else {
      console.log('   ❌ SSH button missing on mobile');
      allPassed = false;
    }
    
    if (mobileSftpBtnExists) {
      console.log('   ✅ SFTP button exists on mobile');
    } else {
      console.log('   ❌ SFTP button missing on mobile');
      allPassed = false;
    }
    
    // Test mobile overflow menu interaction
    console.log('\n🔄 Testing Mobile Overflow Menu Interaction');
    
    // Click overflow toggle
    await mobilePage.click('#overflowToggle');
    await mobilePage.waitForTimeout(100);
    
    const dropdownVisible = await mobilePage.evaluate(() => {
      const el = document.querySelector('#overflowDropdown');
      return el && el.classList.contains('show');
    });
    
    if (dropdownVisible) {
      console.log('   ✅ Overflow dropdown opens on click');
    } else {
      console.log('   ❌ Overflow dropdown does not open');
      allPassed = false;
    }
    
    // Click outside to close
    await mobilePage.click('body', { offset: { x: 0, y: 0 } });
    await mobilePage.waitForTimeout(100);
    
    const dropdownHidden = await mobilePage.evaluate(() => {
      const el = document.querySelector('#overflowDropdown');
      return el && !el.classList.contains('show');
    });
    
    if (dropdownHidden) {
      console.log('   ✅ Overflow dropdown closes when clicking outside');
    } else {
      console.log('   ❌ Overflow dropdown does not close');
      allPassed = false;
    }
    
    await mobilePage.close();
    
    console.log('\n========================================');
    if (allPassed) {
      console.log('✅ All tests passed!');
    } else {
      console.log('❌ Some tests failed');
    }
    console.log('========================================');
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
    allPassed = false;
  } finally {
    await browser.close();
  }
  
  process.exit(allPassed ? 0 : 1);
}

testMobileLayout();