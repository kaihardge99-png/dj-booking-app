function getConfirmationEmailRecipients(customerEmail, adminEmails = []) {
  const to = [customerEmail].filter(Boolean);
  const cc = (adminEmails || [])
    .filter(Boolean)
    .filter((email) => email.toLowerCase() !== (customerEmail || '').toLowerCase());

  return { to, cc };
}

module.exports = { getConfirmationEmailRecipients };
