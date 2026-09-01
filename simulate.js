const crypto = require('crypto');

// ==========================================
// 1. FILL IN THESE THREE VARIABLES
// ==========================================
const SECRET_KEY = "72WWAS0K0A63RJTLVF9UC9FRBA2EG6VL"; // Your Monnify Sandbox Secret Key
const WEBHOOK_URL = "https://cmwhefqflopywessgcwh.supabase.co/functions/v1/monnify-webhook"; // Your live webhook URL
const ACCOUNT_NUMBER = "2210032353"; // The number from your UI

// ==========================================
// 2. THE FAKE MONNIFY PAYLOAD
// ==========================================
const payload = JSON.stringify({
  eventType: "SUCCESSFUL_TRANSACTION",
  eventData: {
    settlementAmount: 100000, // Simulating a ₦15,000 transfer
    transactionReference: "TEST_TX_" + Date.now(), // Random unique reference
    destinationAccountInformation: {
      accountNumber: ACCOUNT_NUMBER
    }
  }
});

// ==========================================
// 3. GENERATE THE HASH SIGNATURE
// ==========================================
const signature = crypto.createHmac('sha512', SECRET_KEY).update(payload).digest('hex');

// ==========================================
// 4. FIRE THE WEBHOOK
// ==========================================
async function runSimulation() {
  console.log("Initiating transaction to webhook...");
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "monnify-signature": signature
      },
      body: payload
    });
    
    const text = await response.text();
    console.log(`Webhook Status: ${response.status}`);
    console.log(`Response: ${text}`);
    console.log("If status is 200, check your Vendi Wallet UI!");
  } catch (error) {
    console.error("Network Error:", error);
  }
}

runSimulation();