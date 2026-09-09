import { api, unwrap } from '../api.js';

export const dashboardApi = {
  overview: () => api.get('/dashboard').then(unwrap),
  calendar: (params) => api.get('/dashboard/calendar', { params }).then(unwrap),
  calendarBookingsTrend: (params) =>
    api.get('/dashboard/calendar-bookings-trend', { params }).then(unwrap),
  revenueSeries: (params) => api.get('/dashboard/revenue-series', { params }).then(unwrap),
  activity: (params) => api.get('/dashboard/activity', { params }).then(unwrap),
};
