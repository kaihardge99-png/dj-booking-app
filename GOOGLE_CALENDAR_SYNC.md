# Google Calendar Sync

The DJ Booking App can now sync blocked dates and events directly from your public Google Calendar. This ensures your Google Calendar availability is automatically reflected in the app.

## Setup

### 1. Get Your Google Calendar Public Link

1. Open [Google Calendar](https://calendar.google.com)
2. Find the calendar you use for bookings (e.g., "allfriendsavhire@gmail.com")
3. Click the three dots next to the calendar name
4. Select **Settings and sharing**
5. Scroll to **Access permissions**
6. Make sure **Make available to the public** is enabled
7. Copy your calendar email address (e.g., `allfriendsavhire@gmail.com`)

### 2. Sync in the Admin Dashboard

1. Log in to the admin dashboard
2. Go to the **Settings** tab
3. Scroll down to **Google Calendar Sync**
4. Enter your Google Calendar email (it will default to `allfriendsavhire@gmail.com`)
5. Click **Sync Google Calendar**

### 3. That's It!

The app will:
- Fetch all events from your public Google Calendar
- Parse event dates and times
- Add them as blocked dates in the app database
- Update the customer-facing availability calendar

## How It Works

**Full-day events** (no specific time):
- Blocks the entire day in the app
- Customers cannot book on that date

**Timed events** (with start and end times):
- Blocks only that time slot
- Customers can still book other hours on that day
- Multi-day events are handled correctly

**Event names** are stored as reasons for the blocked dates, so you can track why a date was blocked.

## Example

If you have a Google Calendar event:
- **Event:** "Studio Maintenance"
- **Date:** August 15, 2026
- **Time:** 2:00 PM - 4:00 PM

This will create a blocked time in the app:
- **Date:** 2026-08-15
- **Time:** 14:00 - 16:00
- **Reason:** Google Calendar: Studio Maintenance
- **Result:** Customers can still book before 2 PM or after 4 PM on that day

## Manual Management

You can still manually add, edit, or remove blocked dates in the **Unavailable Dates** tab. The Google Calendar sync will add to these dates without removing manually-added ones.

## Sync Frequency

Currently, you need to click the **Sync Google Calendar** button manually in the Settings tab. To sync automatically:

You can set up a scheduled task (cron job) to call the API endpoint:

```bash
POST /api/sync-google-calendar
Authorization: Bearer {ADMIN_TOKEN}
Content-Type: application/json

{
  "calendarId": "allfriendsavhire@gmail.com"
}
```

This will keep your Google Calendar and app availability perfectly synchronized.

## Troubleshooting

**"Error syncing calendar"**
- Verify the Google Calendar email is correct
- Make sure the calendar is shared publicly in Google Calendar settings
- Check that the calendar has events (the sync works with any public calendar)

**Dates not appearing**
- Click Sync again after adding events to Google Calendar
- Check the admin dashboard blocked dates list to see if they were added
- Look at the browser console (F12) for any error messages

**Duplicate dates**
- The app uses database "INSERT OR IGNORE" to prevent duplicates
- If you have the same blocked date from multiple sources, it's kept only once
