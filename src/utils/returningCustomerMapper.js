export function mapCustomerToBookingData(customer, email) {
  const hasCustomerProfile = Boolean(customer?.id);

  return {
    firstName: customer?.first_name || '',
    lastName: customer?.last_name || '',
    email: email || customer?.email || '',
    phone: customer?.phone || '',
    contactAddress: {
      street: customer?.street || '',
      city: customer?.city || '',
      state: customer?.state || '',
      zip: customer?.zip || '',
      customerId: customer?.id || null,
      isVerified: hasCustomerProfile,
    },
    addressVerified: hasCustomerProfile,
  };
}
