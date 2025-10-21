require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment Variables
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra API Info
const DAFTRA_API = "https://www.mrphonelb.com/api2";
const API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   💳 Create Mastercard Checkout Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency." });

    console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      interaction: {
        operation: "PURCHASE",
        merchant: { name: "Mr Phone Lebanon", url: "https://www.mrphonelb.com" },
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE", shipping: "HIDE" },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout"
      },
      order: {
        id: orderId,
        amount: amount,
        currency: currency,
        description: "Mr Phone Lebanon Online Purchase"
      }
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log("✅ Mastercard Session Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Mastercard Session Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create session", debug: err.response?.data || err.message });
  }
});

/* ====================================================
   💵 Create Daftra Paid Invoice (after successful payment)
   ==================================================== */
app.post("/payment-success", async (req, res) => {
  try {
    const { client_id, client_name, client_email, base_amount, session_id } = req.body;
    if (!base_amount || !session_id)
      return res.status(400).json({ error: "Missing base_amount or session_id" });

    // ✅ Step 1: Ensure we have a client in Daftra
    let finalClientId = client_id;
    if (!finalClientId || finalClientId === 0) {
      console.log("👤 No client_id provided — searching for 'Online Customer'");
      const clientSearch = await axios.get(`${DAFTRA_API}/clients?name=Online%20Customer`, {
        headers: { "apikey": API_KEY, "Accept": "application/json" }
      });

      if (clientSearch.data?.result === "successful" && clientSearch.data?.data?.length > 0) {
        finalClientId = clientSearch.data.data[0].id;
      } else {
        console.log("👤 Creating new Daftra client: Online Customer");
        const newClient = await axios.post(
          `${DAFTRA_API}/clients`,
          {
            Client: {
              name: client_name || "Online Customer",
              email: client_email || "",
              currency_code: "USD",
              type: "client"
            }
          },
          { headers: { "apikey": API_KEY, "Content-Type": "application/json" } }
        );
        finalClientId = newClient.data.id;
      }
    }

    // ✅ Step 2: Prepare invoice data
    const fee = +(base_amount * 0.035).toFixed(2);
    const totalPaid = +(base_amount + fee).toFixed(2);
    const today = new Date().toISOString().split("T")[0];

    const invoicePayload = {
      Invoice: {
        client_id: finalClientId,
        date: today,
        currency_code: "USD",
        draft: false,
        payment_status: "paid",
        name: "Mr Phone LB Online Purchase",
        notes: `Paid via Mastercard (Session: ${session_id})`,
        total: totalPaid
      },
      InvoiceItem: [
        {
          item: "Online Order",
          description: "Checkout Payment",
          unit_price: base_amount,
          quantity: 1
        },
        {
          item: "Card Payment Fee (3.5%)",
          description: "Processing fee for Mastercard payment",
          unit_price: fee,
          quantity: 1
        }
      ],
      Payment: [
        {
          payment_method: "Credit / Debit Card (Mastercard)",
          amount: totalPaid,
          transaction_id: session_id,
          date: new Date().toISOString().replace("T", " ").slice(0, 19)
        }
      ]
    };

    // ✅ Step 3: Send to Daftra
    const daftraRes = await axios.post(`${DAFTRA_API}/invoices`, invoicePayload, {
      headers: {
        "Accept": "application/json",
        "apikey": API_KEY,
        "Content-Type": "application/json"
      }
    });

    console.log("✅ Daftra Invoice Created:", daftraRes.data);
    res.json(daftraRes.data);

  } catch (err) {
    console.error("❌ Daftra Invoice Creation Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Daftra invoice",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🧠 Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend ready for Mastercard + Daftra Integration (Paid Invoice).");
});

/* ====================================================
   🚀 Start Server
   ==================================================== */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
