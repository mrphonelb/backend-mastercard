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
   💳 1) Create Mastercard Session (Modern Hosted Checkout)
   - Adds redirect + retry controls
   - Hides billing address inside MPGS UI
   - Returns session.id + successIndicator to frontend
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const {
      orderId,
      amount,
      currency = "USD",
      returnUrl = "https://www.mrphonelb.com/client/contents/checkout?payment=success",
      redirectMerchantUrl = "https://www.mrphonelb.com/client/contents/payment_error",
      retryAttemptCount = 2
    } = req.body;

    if (!orderId || !amount || !currency) {
      return res.status(400).json({ error: "Missing orderId, amount, or currency" });
    }

    console.log(`💰 Creating MPGS session | Order:${orderId} | ${amount} ${currency}`);

    // ⚠️ Modern Hosted Checkout: INITIATE_CHECKOUT at /session (v>=63)
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: String(orderId),
        amount: Number(amount),
        currency: currency,
        description: "Mr Phone"
      },
      interaction: {
  operation: "PURCHASE",
  merchant: {
    name: "Mr Phone Lebanon",
    logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
    url: "https://www.mrphonelb.com"
  },
        // success redirect (always)
        returnUrl,
        // failure/cancel handling (retry, then redirect)
        redirectMerchantUrl,
        retryAttemptCount,
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE"
          // shipping: "HIDE" // uncomment if enabled for your account
        }
      }
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    // MPGS returns session + successIndicator for Modern flow
    const data = response.data || {};
    console.log("✅ MPGS session created:", {
      sessionId: data?.session?.id,
      successIndicator: data?.successIndicator
    });

    return res.json({
      ok: true,
      session: data.session || null,
      successIndicator: data.successIndicator || null,
      raw: data
    });
  } catch (err) {
    console.error("❌ MPGS session error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🔍 2) Retrieve Mastercard Order Details
   - Useful for server-side verification/logging
   ==================================================== */
app.get("/retrieve-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`🔍 Retrieving MPGS order: ${orderId}`);

    const response = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    console.log("✅ Order retrieved");
    return res.json(response.data);
  } catch (err) {
    console.error("❌ Retrieve order error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to retrieve Mastercard order",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🧾 3) Create Draft Invoice in Daftra (server-side option)
   - Keep if you sometimes want server-side draft creation
   ==================================================== */
app.post("/create-draft", async (req, res) => {
  try {
    const { client_id, items = [], total, currency_code = "USD", notes } = req.body;
    if (!client_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Missing client_id or items[]" });
    }

    const payload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code,
        notes: notes || "Online draft created after MPGS verification"
      },
      InvoiceItem: items
    };

    const response = await axios.post("https://www.mrphonelb.com/api2/invoices", payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY
      },
      timeout: 20000
    });

    console.log("✅ Daftra draft created:", response.data);
    return res.json(response.data);
  } catch (err) {
    console.error("❌ Daftra draft error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Daftra draft",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💳 4) Verify Payment + Redirect (no server draft)
   - Confirms success by checking order.status
   - Redirects back to checkout on success (frontend auto-clicks Place Order)
   - Redirects to payment_error on failure/cancel
   ==================================================== */
app.get("/verify-payment/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`🔍 Verifying MPGS payment for order: ${orderId}`);

    const orderResp = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    const d = orderResp.data || {};
    const result = d?.result; // "SUCCESS" | "ERROR"
    const status = d?.order?.status || d?.status; // "CAPTURED" | "AUTHORIZED" | "FAILED" | "CANCELLED"
    console.log("ℹ️ MPGS verify result:", { result, status });

    if (result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED")) {
      // ✅ Back to checkout to finalize (auto click Place Order in your JS)
      return res.redirect(
        "https://www.mrphonelb.com/client/contents/checkout?payment=success&src=verify"
      );
    }

    // ❌ Failed / Cancelled
    return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
  } catch (err) {
    console.error("❌ Payment verification error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/payment_error");
  }
});

/* ====================================================
   🧠 5) Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready: Mastercard (MPGS) + Daftra Integration.");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
