require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra API key (not OAuth)
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   💳 1. Create Mastercard Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency" });

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
    res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🔍 2. Retrieve Mastercard Order Details
   ==================================================== */
app.get("/retrieve-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`🔍 Retrieving Mastercard order: ${orderId}`);

    const response = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${orderId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log("✅ Order Retrieved:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Retrieve Order Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to retrieve Mastercard order",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🧾 3. Create Draft Invoice in Daftra (API Key)
   ==================================================== */
app.post("/create-draft", async (req, res) => {
  try {
    const { client_id, items, total } = req.body;
    if (!client_id || !items || !total)
      return res.status(400).json({ error: "Missing client_id, items, or total" });

    const payload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: "USD",
        notes: "Online draft created after Mastercard payment verification"
      },
      InvoiceItem: items
    };

    const response = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      payload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        },
        timeout: 15000
      }
    );

    console.log("✅ Draft Invoice Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Daftra Draft Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Daftra draft",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💳 4. Verify Payment + Redirect
   ==================================================== */
app.get("/verify-payment/:orderId/:clientId", async (req, res) => {
  try {
    const { orderId, clientId } = req.params;
    console.log(`🔍 Verifying payment for Order ${orderId} | Client ${clientId}`);

    // ✅ Step 1: Retrieve Mastercard order details
    const orderResponse = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${orderId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    const orderData = orderResponse.data;
    console.log("✅ Order Data Retrieved:", orderData);

    // ✅ Step 2: Check payment result
    if (orderData.result === "SUCCESS") {
      const amount = orderData.amount;

      // ✅ Step 3: Create Daftra draft invoice
      const draftRes = await axios.post(
        "https://www.mrphonelb.com/api2/invoices",
        {
          Invoice: {
            client_id: clientId,
            draft: true,
            is_offline: true,
            currency_code: "USD",
            notes: `Verified Mastercard payment success for order ${orderId}`
          },
          InvoiceItem: [
            {
              item: "Online Order Payment",
              description: `Mastercard order ${orderId}`,
              unit_price: amount,
              quantity: 1
            }
          ]
        },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            apikey: DAFTRA_API_KEY
          }
        }
      );

      const draftData = draftRes.data;
      console.log("✅ Draft created after verification:", draftData);

      if (draftData.result === "successful" && draftData.id) {
        // ✅ Redirect to thank you page
        return res.redirect(
          `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftData.id}`
        );
      } else {
        console.warn("⚠️ Draft creation failed:", draftData);
        return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
      }
    } else {
      console.warn("⚠️ Payment not successful:", orderData.result);
      return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
    }
  } catch (err) {
    console.error("❌ Payment Verification Error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
  }
});

/* ====================================================
   🧠 5. Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready: Mastercard + Daftra Integration Working.");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
