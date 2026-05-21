# Email Configuration Setup

To enable email confirmations for bookings, you need to set up Gmail authentication:

## Steps:

1. **Enable 2-Factor Authentication on your Gmail account:**
   - Go to https://myaccount.google.com/security
   - Click "2-Step Verification"
   - Follow the setup process

2. **Generate an App Password:**
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer" (or your device)
   - Google will generate a 16-character password
   - Copy this password

3. **Update your .env file:**
   - Open `/workspace/.env`
   - Replace `your_email@gmail.com` with your Gmail address
   - Replace `your_app_password` with the 16-character password from step 2
   - Example:
     ```
     EMAIL_USER=youremail@gmail.com
     EMAIL_PASSWORD=abcd efgh ijkl mnop
     ```

4. **Restart the server:**
   - The emails will now be sent automatically when bookings are made

## Testing:

After updating the .env file and restarting the server, make a test booking and check:
- Your email inbox for the confirmation
- The admin emails (allfriendsavhire@gmail.com, kaihardge@gmail.com) for the notification

## Troubleshooting:

If emails still don't arrive:
- Check the server logs for error messages
- Verify the Gmail credentials are correct
- Make sure 2-Factor Authentication is enabled
- Check spam/junk folders
