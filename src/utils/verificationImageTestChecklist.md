
# Verification Image Consistency Test Checklist

## 1. Baseline Verification
- [ ] Open Admin Dashboard > Customer Detail > "Full History" dialog.
- [ ] Verify that images load correctly using the legacy fallback logic (if existing in `customers` table JSONB).
- [ ] Verify that images load correctly if records exist in `driver_verification_documents` table.

## 2. Customer Verification (Admin Customer Detail)
- [ ] Navigate to Admin > Customer Detail page.
- [ ] Check the "Vehicle & License Details" section.
- [ ] Confirm images load and display cleanly using the new `VerificationImageDisplay` component.
- [ ] Click the "Approve Docs" and "Reject Docs" buttons to verify status changes.
- [ ] Verify the "Audit Trail" section lists past changes and allows viewing previous versions.

## 3. Pending Verifications Manager
- [ ] Navigate to Admin > pending address verifications (or pending bookings).
- [ ] Click "Verify & Approve" to open the approval dialog.
- [ ] Confirm the "License Verification Documents" section shows the front and back images perfectly formatted using the unified component.

## 4. Customer Portal
- [ ] Log in as a customer and navigate to "My Verification" in the portal.
- [ ] Check that the "Current Verification Status" card shows the same images seen in the Admin views.
- [ ] Upload new front and back images, and hit "Submit Updates".
- [ ] Ensure the display automatically updates with the new versions.

## 5. Download Functionality
- [ ] In Admin Full History: Click Download, verify file downloads properly.
- [ ] In Admin Customer Detail: Click Download on the unified component.
- [ ] In Customer Portal: Click Download on the unified component.

## 6. History and Audit Trail
- [ ] Trigger an image replacement via the Customer Portal.
- [ ] Go back to Admin > Customer Detail.
- [ ] Verify the new image displays as active.
- [ ] Verify the Audit Trail correctly captured the "replaced" action and retained the history of the previous image.

## 7. Error Handling and Empty States
- [ ] View a customer who has never uploaded images.
- [ ] Confirm the unified component gracefully shows "No verification documents uploaded yet."
- [ ] Intentionally break the network request and verify the "Retry" button appears.

## Compliance Check
- All actions are tracked via `verification_image_history` table triggers.
- Timestamps and User IDs are recorded for each document change.
