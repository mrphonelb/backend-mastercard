require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔧 Environment variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔑 Daftra API key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// Simple in-memory store for temporary cart data (you can move to DB later)
const TEMP_STORE = {};

/* ====================================================
   💳 1) Create Mastercard Session (no Daftra draft yet)
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;
    if (!client_id || !total || !items.length)
      return res.status(400).json({ error: "Missing client_id, total, or items[]" });

    const baseTotal = Number(total);
    const gatewayTotal = +(baseTotal * 1.035).toFixed(2); // +3.5 % fee for customer only

    console.log(`💳 Starting Mastercard session | Client:${client_id} | Base:$${baseTotal} | Gateway:$${gatewayTotal}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: `TEMP-${Date.now()}`,
        amount: gatewayTotal,
        currency,
        description: "Mr Phone LB Online Purchase (+3.5% fee included)"
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com"
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}`,
        redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=unknown`,
        retryAttemptCount: 2,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" }
      }
    };

    const resp = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = resp.data;
    TEMP_STORE[data.session.id] = { client_id, items, baseTotal };
    console.log("✅ MPGS session created:", data.session?.id);

    res.json({
      ok: true,
      session: data.session,
      successIndicator: data.successIndicator
    });
  } catch (err) {
    console.error("❌ Session creation error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💳 2) Verify Payment → Create Daftra Draft & Payment
   ==================================================== */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const sessionId = req.query.sessionId;
    const cart = TEMP_STORE[sessionId];

    if (!sessionId || !cart) {
      console.warn("⚠️ Missing or expired session data");
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    delete TEMP_STORE[sessionId];
    const { client_id, items, baseTotal } = cart;

    console.log(`🔍 Verifying payment for session ${sessionId} | client ${client_id}`);

    const verifyResp = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session/${sessionId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = verifyResp.data;
    const result = data.result;
    const status = data.status;

    if (result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED")) {
      console.log("✅ Payment verified successfully — creating Daftra draft...");

      // 1️⃣ Create Daftra invoice draft with real items & prices (no fee)
      const draftRes = await axios.post(
        "https://www.mrphonelb.com/api2/invoices",
        {
          Invoice: {
            client_id,
            draft: false,
            is_offline: true,
            currency_code: "USD",
            notes: "✅ Mastercard payment successful (3.5% fee paid externally)"
          },
          InvoiceItem: items.map(i => ({
            item: i.item,
            description: i.description || "",
            unit_price: Number(i.unit_price),
            quantity: Number(i.quantity)
          }))
        },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            apikey: DAFTRA_API_KEY
          }
        }
      );

      const draft = draftRes.data;
      console.log("✅ Daftra draft created:", draft.id);

      // 2️⃣ Record payment for base total (no fee)
      await axios.post(
        "https://www.mrphonelb.com/api2/invoices/payments",
        {
          InvoicePayment: {
            invoice_id: draft.id,
            amount: baseTotal, // without 3.5%
            method: "Credit/Debit Card (Mastercard)",
            notes: "Online payment via Mastercard (customer paid +3.5% fee separately)"
          }
        },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            apikey: DAFTRA_API_KEY
          }
        }
      );

      console.log(`💰 Payment record created in Daftra for invoice ${draft.id}`);

      return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`);
    }

    console.warn("⚠️ Payment failed or cancelled:", { result, status });
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ====================================================
   🧠 3) Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready — Draft AFTER payment, no fee inside Daftra.");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
