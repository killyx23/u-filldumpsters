# Access Codes Feature - Manual Testing Checklist

## Test Environment Setup
- [ ] Browser: Chrome/Firefox/Safari (test on all three if possible)
- [ ] Mobile Device: iOS Safari and Android Chrome
- [ ] Network: Test on both WiFi and mobile data

---

## 1. Portal Login & Navigation Tests

### 1.1 Existing Portal Login (Customer ID + Phone)
- [ ] Navigate to `/portal` (main customer portal)
- [ ] Enter valid Customer ID (format: CID-XXXXXX)
- [ ] Enter valid phone number
- [ ] Click "Access Portal" button
- [ ] Verify successful login and redirect to dashboard

**Expected Result:** Portal loads with customer data, sidebar navigation visible

### 1.2 Access Codes Menu Item
- [ ] After login, locate sidebar navigation
- [ ] Verify "Access Codes" menu item is visible
- [ ] Verify it appears in correct order (after Dashboard)
- [ ] Verify icon is displayed (Key icon)
- [ ] Click "Access Codes" menu item
- [ ] Verify URL changes to `/portal?tab=access-codes`

**Expected Result:** Access Codes page loads, content displays correctly

---

## 2. Access Codes Page Content Tests

### 2.1 Rental Details Display
- [ ] Verify "Rental Details" card is visible
- [ ] Verify customer name displays correctly
- [ ] Verify Order ID displays
- [ ] Verify service type shows "Dump Loader Trailer Rental"
- [ ] Verify pickup date and time are correct
- [ ] Verify return date and time are correct

**Expected Result:** All booking information displays accurately

### 2.2 Access PIN Display
- [ ] Verify PIN displays in HUGE, BOLD, MONOSPACE font
- [ ] Verify PIN text size is at least 48px (text-6xl or larger)
- [ ] Verify PIN has high contrast (white text on dark background)
- [ ] Verify PIN is centered on page
- [ ] Verify label "YOUR ACCESS PIN" appears above PIN
- [ ] Verify label "Enter this code at the lock" appears below PIN

**Expected Result:** PIN is clearly visible, readable from distance, professional appearance

### 2.3 Validity Warning Box
- [ ] Verify warning box displays with professional styling
- [ ] Verify light blue or yellow background (bg-blue-50 or bg-yellow-50)
- [ ] Verify icon is present (⏰ or info icon)
- [ ] Verify text clearly states rental period validity
- [ ] Verify start and end times are displayed
- [ ] Verify warning is not alarming, but professional in tone

**Expected Result:** Warning is clear, professional, and informative

---

## 3. QR Code Tests

### 3.1 QR Code Generation
- [ ] Verify two QR codes are displayed
- [ ] Verify first QR code is labeled "Access Code" or "Scan to View Access Code"
- [ ] Verify second QR code is labeled "Safety Instructions" or "Scan for Trailer Safety"
- [ ] Verify both QR codes are at least 200x200px
- [ ] Verify QR codes have clear instruction text below them

**Expected Result:** Both QR codes visible, properly sized, clearly labeled

### 3.2 Access Code QR - Magic Link Test
- [ ] Use phone camera to scan the first QR code
- [ ] Verify camera recognizes the QR code
- [ ] Verify URL is recognized (should show notification/preview)
- [ ] Tap the URL notification to open
- [ ] Verify browser opens to the magic link URL

**Expected Result:** QR code scans successfully, URL opens in browser

### 3.3 Magic Link Auto-Login (Not Logged In)
- [ ] Ensure you are NOT logged into the portal
- [ ] Scan Access Code QR with phone
- [ ] Tap URL to open in browser
- [ ] Verify loading/processing message appears
- [ ] Verify automatic login occurs
- [ ] Verify redirect to `/portal?tab=access-codes`
- [ ] Verify Access Codes page loads with PIN visible
- [ ] Verify customer is now logged in (sidebar shows user info)

**Expected Result:** Automatic login works seamlessly, no manual login required

### 3.4 Magic Link Auto-Login (Already Logged In)
- [ ] Ensure you ARE logged into the portal
- [ ] Scan Access Code QR with phone
- [ ] Tap URL to open in browser
- [ ] Verify immediate redirect to `/portal?tab=access-codes`
- [ ] Verify Access Codes page loads without re-authentication

**Expected Result:** Redirect works without re-login prompt

### 3.5 Safety Video QR Test
- [ ] Use phone camera to scan the second QR code
- [ ] Verify camera recognizes the QR code
- [ ] Tap URL to open in browser
- [ ] Verify redirect to `/customer-portal/resources` (How-To & Guides page)
- [ ] Verify resources page loads correctly
- [ ] Verify safety videos/guides are visible

**Expected Result:** Safety video QR links to correct resources page

---

## 4. Error Handling Tests

### 4.1 PIN Not Yet Generated
- [ ] Test with a booking where PIN hasn't been created yet
- [ ] Navigate to Access Codes page
- [ ] Verify message: "Your access code is being generated. Please refresh in a moment."
- [ ] Verify "Refresh" button is visible
- [ ] Click "Refresh" button
- [ ] Verify page re-fetches data

**Expected Result:** Clear message, refresh option works

### 4.2 Rental Period Ended
- [ ] Test with a booking where rental period has ended (return date in past)
- [ ] Navigate to Access Codes page
- [ ] Verify message: "This rental period has ended. Your access code is no longer valid."
- [ ] Verify message is styled with red/warning colors
- [ ] Verify PIN is not displayed

**Expected Result:** Clear expired message, no PIN shown

### 4.3 No Active Booking
- [ ] Log in as a customer with no active rental
- [ ] Navigate to Access Codes page
- [ ] Verify message: "No active rental found"
- [ ] Verify booking details card does not display
- [ ] Verify PIN section does not display

**Expected Result:** Clear "no rental" message

### 4.4 Invalid/Expired Magic Link Token
- [ ] Manually create a magic link URL with invalid token
- [ ] Open URL in browser
- [ ] Verify error message: "Invalid or expired link"
- [ ] Verify redirect to portal login page
- [ ] Verify toast notification shows error

**Expected Result:** Clear error handling, redirect to login

---

## 5. Receipt QR Code Tests

### 5.1 QR Codes on Receipt
- [ ] Log into portal
- [ ] Navigate to Documents page
- [ ] View receipt for Dump Loader Trailer rental
- [ ] Scroll to QR codes section
- [ ] Verify both QR codes are visible on receipt
- [ ] Verify warning text is present: "⚠️ PRIVATE INFORMATION: These QR codes contain your personal rental information..."
- [ ] Verify instruction text is clear

**Expected Result:** QR codes clearly visible on receipt with warnings

### 5.2 Print Receipt QR Codes
- [ ] Open receipt page
- [ ] Click "Print Receipt" button
- [ ] Verify print preview shows QR codes
- [ ] Verify QR codes are large enough to scan when printed
- [ ] Print receipt to PDF or physical printer
- [ ] Scan QR codes from printed receipt with phone

**Expected Result:** QR codes are scannable from printed receipt

---

## 6. Mobile Responsiveness Tests

### 6.1 Access Codes Page - Mobile
- [ ] Open portal on mobile device (< 768px width)
- [ ] Log in successfully
- [ ] Navigate to Access Codes page
- [ ] Verify page layout stacks vertically
- [ ] Verify PIN is full-width with large spacing
- [ ] Verify PIN text is large and readable
- [ ] Verify QR codes stack vertically
- [ ] Verify all content is readable without horizontal scroll

**Expected Result:** Mobile layout works perfectly, easy to read while standing at trailer

### 6.2 Sidebar Navigation - Mobile
- [ ] On mobile, verify sidebar is accessible via menu button
- [ ] Tap menu icon
- [ ] Verify sidebar slides in from left
- [ ] Verify "Access Codes" menu item is visible
- [ ] Tap "Access Codes" menu item
- [ ] Verify page navigates correctly

**Expected Result:** Mobile sidebar navigation works smoothly

---

## 7. Security & Session Tests

### 7.1 Session Persistence
- [ ] Log in to portal
- [ ] Navigate to Access Codes page
- [ ] Close browser tab
- [ ] Re-open portal URL
- [ ] Verify session persists (still logged in)
- [ ] Navigate to Access Codes page again
- [ ] Verify PIN still displays

**Expected Result:** Session persists across browser restarts

### 7.2 Magic Link Token Expiration
- [ ] Generate magic link QR code
- [ ] Wait 24+ hours
- [ ] Scan QR code
- [ ] Verify error: "Token expired"
- [ ] Verify redirect to login page

**Expected Result:** Expired tokens are rejected with clear message

### 7.3 Magic Link Token One-Time Use
- [ ] Generate magic link QR code
- [ ] Scan and login successfully
- [ ] Log out from portal
- [ ] Scan same QR code again
- [ ] Verify error: "Token already used"
- [ ] Verify redirect to login page

**Expected Result:** Tokens can only be used once

---

## 8. Cross-Browser Tests

### 8.1 Chrome Desktop
- [ ] Test all above steps in Chrome
- [ ] Verify QR code generation works
- [ ] Verify magic links work
- [ ] Verify layout is correct

### 8.2 Firefox Desktop
- [ ] Test all above steps in Firefox
- [ ] Verify QR code generation works
- [ ] Verify magic links work
- [ ] Verify layout is correct

### 8.3 Safari Desktop (Mac)
- [ ] Test all above steps in Safari
- [ ] Verify QR code generation works
- [ ] Verify magic links work
- [ ] Verify layout is correct

### 8.4 Safari Mobile (iOS)
- [ ] Test QR code scanning with iPhone camera
- [ ] Test magic link auto-login
- [ ] Test page layout on iPhone
- [ ] Verify PIN is readable

### 8.5 Chrome Mobile (Android)
- [ ] Test QR code scanning with Android camera
- [ ] Test magic link auto-login
- [ ] Test page layout on Android
- [ ] Verify PIN is readable

---

## 9. Integration Tests

### 9.1 Existing Portal Functionality
- [ ] Verify Dashboard page still works
- [ ] Verify Bookings page still works
- [ ] Verify Tracking page still works
- [ ] Verify Calendar page still works
- [ ] Verify Documents page still works
- [ ] Verify How-To & Guides page still works
- [ ] Verify Profile page still works
- [ ] Verify Verification page still works
- [ ] Verify Communication page still works

**Expected Result:** No existing portal pages have been broken

### 9.2 Logout Flow
- [ ] Log in to portal
- [ ] Navigate to Access Codes page
- [ ] Click logout button
- [ ] Verify logout occurs
- [ ] Verify redirect to login page
- [ ] Verify session is cleared

**Expected Result:** Logout works correctly from Access Codes page

---

## 10. Performance Tests

### 10.1 Page Load Speed
- [ ] Navigate to Access Codes page
- [ ] Measure time to display PIN (should be < 2 seconds)
- [ ] Verify QR codes generate quickly (< 3 seconds)

**Expected Result:** Page loads quickly, no long delays

### 10.2 Refresh Functionality
- [ ] Click "Refresh" button on Access Codes page
- [ ] Verify data re-fetches without full page reload
- [ ] Verify loading indicator appears during refresh

**Expected Result:** Smooth refresh experience

---

## Issues Found

### Issue Template