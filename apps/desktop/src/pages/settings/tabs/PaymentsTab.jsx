import Tab from './_Tab.jsx';

const PaymentsTab = () => (
  <Tab
    title="Payments & Accounts"
    description="User payment accounts, gateway integrations, cash ledgers"
  >
    <p className="text-sm text-gray-500">
      Per-user payment accounts (Cash / UPI / Bank) with opening balance, reconciliation, online
      gateway integrations (Razorpay / PhonePe / Paytm), payment modes visible at checkout.
    </p>
  </Tab>
);

export default PaymentsTab;
