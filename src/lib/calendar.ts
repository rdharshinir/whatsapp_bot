import { google, calendar_v3 } from 'googleapis';

import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const getAuthClient = () => {
  // Use the provided JSON key file directly
  const keyFilePath = path.join(process.cwd(), 'calender-497404-f6023532c0fd.json');

  return new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: SCOPES,
  });
};

const getCalendar = () => {
  const auth = getAuthClient();
  return google.calendar({ version: 'v3', auth });
};

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

/**
 * Checks for available slots on a given date between 9 AM and 5 PM
 * @param date ISO string of the date to check (e.g., '2026-05-25')
 */
export async function getFreeBusy(date: string) {
  const calendar = getCalendar();
  
  // Set start to 9 AM and end to 5 PM of the requested date
  const startOfDay = new Date(date);
  startOfDay.setHours(9, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(17, 0, 0, 0);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busySlots = res.data.calendars?.[CALENDAR_ID]?.busy || [];
  
  return {
    date,
    businessHours: {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString(),
    },
    busySlots,
  };
}

/**
 * Creates an event in Google Calendar
 */
export async function createEvent(name: string, service: string, startTime: string, endTime: string) {
  const calendar = getCalendar();

  const event: calendar_v3.Schema$Event = {
    summary: `Appointment: ${service} - ${name}`,
    description: `Automated booking via WhatsApp AI Agent for ${name}. Service: ${service}.`,
    start: {
      dateTime: startTime,
      timeZone: 'UTC', // Ensure timezones are handled correctly based on your deployment
    },
    end: {
      dateTime: endTime,
      timeZone: 'UTC',
    },
  };

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event,
  });

  return res.data;
}
