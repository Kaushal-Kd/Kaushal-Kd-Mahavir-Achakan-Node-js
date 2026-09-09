export function classifyReturnSettlementError(error) {
  const response = error?.response;
  const status = Number(response?.status || 0);

  if (!response) {
    return {
      refreshBooking: true,
      message: 'Connection error. Refresh and check the booking before trying again.',
    };
  }
  if (status === 408 || status === 429) {
    return {
      refreshBooking: true,
      message: 'Temporary server error. Refresh and check the booking before trying again.',
    };
  }
  if (status >= 500) {
    return {
      refreshBooking: true,
      message:
        response?.data?.error?.message ||
        'Server error while saving the return. Refresh and check the booking before trying again.',
    };
  }
  return {
    refreshBooking: false,
    message: response?.data?.error?.message || error?.message || 'Could not save return',
  };
}
