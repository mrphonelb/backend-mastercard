require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// ✅ Test route
app.get("/", (req, res) => {
  res.send("✅ Backend is running and ready for Mastercard Hosted Checkout!");
});


// ==============================================
// ✅ INITIATE CHECKOUT ENDPOINT
// ==============================================
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency, draftId, invoiceId, description } = req.body;

  // Use draftId as Mastercard order ID
  const orderId = draftId;

  try {
    console.log("🧾 Incoming payment data:", req.body);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        checkoutMode: "WEBSITE",
        interaction: {
          operation: "PURCHASE",
          locale: "en_US",
          merchant: {
            name: "Mr. Phone Lebanon",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
            url: "https://www.mrphonelb.com",
          },
          displayControl: {
            billingAddress: "HIDE",
            customerEmail: "HIDE",
            shipping: "HIDE",
          },
          returnUrl: `https://www.mrphonelb.com/client/contents/thankyou?order_id=${orderId}`,
          redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?order_id=${orderId}`,
          retryAttemptCount: 2,
        },
        order: {
          id: orderId,
          amount: amount,
          currency: currency,
          description: description || `Order #${orderId} - Mr. Phone Lebanon`,
        },
      },
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Response from Mastercard:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error(
      "❌ Error from Mastercard API:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      error: "Failed to initiate checkout",
      details: error.response ? error.response.data : error.message,
    });
  }
});


// ==============================================
// ✅ RETRIEVE ORDER ENDPOINT (check payment status)
// ==============================================
app.get("/retrieve-order/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const response = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Retrieved order ${orderId}:`, response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error retrieving order:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to retrieve order",
      details: error.response?.data || error.message,
    });
  }
});


// ==============================================
// ✅ CREATE DAFTRA INVOICE AFTER PAYMENT SUCCESS
// ==============================================
app.post("/create-daftra-invoice", async (req, res) => {
  const { orderId, amount, currency, cardType, client } = req.body;

  if (!orderId || !amount) {
    return res.status(400).json({ error: "Missing order data" });
  }

  try {
    console.log(`🧾 Creating Daftra Invoice for Order ${orderId}...`);

    const response = await axios.post(
      `${process.env.DAFTRA_DOMAIN}/api2/invoices`,
      {
        Invoice: {
          name: `Online Payment Order #${orderId}`,
          draft: false, // make it a final invoice
          currency_code: currency || "USD",
          client_id: client?.id || 1, // replace with real client if you track it
          date: new Date().toISOString().split("T")[0],
          notes: `Paid online via Mastercard (${cardType || "Card"})`,
          discount: 0,
          deposit: 0,
        },
        Payment: [
          {
            payment_method: "Credit/Debit Card",
            amount: parseFloat(amount),
            transaction_id: orderId,
            date: new Date().toISOString().slice(0, 19).replace("T", " "),
            staff_id: 0,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.DAFTRA_API_KEY,
          Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
        },
      }
    );

    console.log("✅ Daftra Invoice Created:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Error creating Daftra invoice:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create Daftra invoice",
      details: error.response?.data || error.message,
    });
  }
});


// ==============================================
// ✅ START SERVER
// ==============================================
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
