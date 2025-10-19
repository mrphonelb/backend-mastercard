require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* =========================
   🔐 CORS (tighten for prod)
   ========================= */
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim())
      : ["https://www.mrphonelb.com"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options(/.*/, cors());
app.use(express.json());

/* =========================
   🧩 ENV sanity checks
   ========================= */
const PORT = process.env.PORT || 3000;
let HOST = process.env.HOST || ""; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com/
if (!HOST.endsWith("/")) HOST += "/";

const MERCHANT_ID = process.env.MERCHANT_ID;      // e.g. TEST_XXXX or live merchant
const API_PASSWORD = process.env.API_PASSWORD;    // NetCommerce API password
const DAFTRA_API_KEY = process.env.DAFTRA_API_KEY; // Daftra v2 API key (Bearer ...)
const THANKYOU_URL = process.env.THANKYOU_URL || "https://www.mrphonelb.com/client/contents/thankyou";
const ERROR_URL = process.env.ERROR_URL || "https://www.mrphonelb.com/client/contents/error";

function requireEnv(name) {
  if (!process.env[name]) {
    console.warn(`⚠️ Missing ENV: ${name}`);
  }
}
["HOST", "MERCHANT_ID", "API_PASSWORD", "DAFTRA_API_KEY"].forEach(requireEnv);

/* =========================
   🛠️ Helpers
   ========================= */
const mp = axios.create({
  baseURL: HOST,
  timeout: 20000,
  auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
  headers: { "Content-Type": "application/json" },
});

function logAxiosError(prefix, err) {
  console.error(prefix);
  if (err.response) {
    console.error("  ↳ Status:", err.response.status);
    console.error("  ↳ Data:", JSON.stringify(err.response.data, null, 2));
  } else {
    console.error("  ↳ Message:", err.message);
  }
}

/* =========================
   🩺 Health
   ========================= */
app.get("/", (_req, res) => {
  res.send("✅ MrPhone Backend running (Mastercard Hosted Checkout → Daftra invoice).");
});

/* ==========================================================
   💳 Create Mastercard session (no Daftra calls here)
   ========================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const {
    amount,
    currency = "USD",
    orderId: clientOrderId,
    description,
    customer,
  } = req.body || {};

  try {
    // Basic validation
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const orderId = clientOrderId || `ORDER-${Date.now()}`;

    // Build the INITIATE_CHECKOUT request body
    const body = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr. Phone Lebanon",
          url: "https://www.mrphonelb.com",
          logo:
            "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
        },
        locale: "en_US",
        // Backend returnUrl: we will verify and then redirect to the final page
        returnUrl: `${process.env.PUBLIC_BASE_URL || ""}/payment-result/${orderId}`,
        displayControl: {
          billingAddress: "HIDE",
          shipping: "HIDE",
          customerEmail: "HIDE",
        },
      },
      order: {
        id: orderId,
        amount: numericAmount,
        currency,
        description: description || `Order #${orderId} - Mr. Phone Lebanon`,
      },
      customer: {
        firstName: customer?.firstName || "Guest",
        lastName: customer?.lastName || "Customer",
        email: customer?.email || "guest@mrphonelb.com",
        mobilePhone: customer?.phone || "00000000",
      },
    };

    // Create a session
    const resp = await mp.post(
      `api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      body
    );

    console.log("✅ Session created:", resp.data?.session?.id);

    res.json({
      success: true,
      orderId,
      sessionId: resp.data?.session?.id,
      successIndicator: resp.data?.successIndicator,
    });
  } catch (err) {
    logAxiosError("❌ INITIATE_CHECKOUT failed", err);
    res.status(500).json({ error: "Failed to create Mastercard session" });
  }
});

/* ==========================================================
   🔎 Utility: check MPGS order (manual debug)
   ========================================================== */
app.get("/debug/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const r = await mp.get(
      `api/rest/version/100/merchant/${MERCHANT_ID}/order/${orderId}`
    );
    res.json(r.data);
  } catch (err) {
    logAxiosError("❌ Retrieve order failed", err);
    res.status(500).json({ error: "Failed to retrieve order" });
  }
});

/* ==========================================================
   🧾 returnUrl handler:
   - verify payment result with MPGS
   - on success: create Daftra regular PAID invoice
   - then redirect user to thankyou or error
   ========================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    // Query MPGS order
    const verify = await mp.get(
      `api/rest/version/100/merchant/${MERCHANT_ID}/order/${orderId}`
    );

    const data = verify.data || {};
    const result = (data.result || "").toUpperCase();
    const status = (data.status || "").toUpperCase();

    console.log(`🔍 MPGS result for ${orderId} → result=${result} status=${status}`);

    const success =
      result === "SUCCESS" ||
      status === "CAPTURED" ||
      status === "COMPLETED" ||
      status === "PAID";

    if (!success) {
      console.warn(`❌ Payment not successful for ${orderId}`);
      return res.redirect(`${ERROR_URL}?invoice_id=${orderId}`);
    }

    // Amount & currency from the order data (fallbacks to request)
    const paidAmount = Number(data.amount || 0);
    const paidCurrency = data.currency || "USD";

    // Create Daftra regular invoice (paid)
    try {
      const inv = await axios.post(
        "https://www.daftra.com/v2/api/entity/invoice",
        {
          draft: false,           // ✅ regular invoice (not draft)
          name: `Online Order ${orderId}`,
          currency: paidCurrency, // match MPGS currency
          status: "paid",
          items: [
            {
              name: `Payment via Mastercard (${orderId})`,
              price: paidAmount,
              qty: 1,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${DAFTRA_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        }
      );

      const invoiceId = inv.data?.id;
      console.log("✅ Daftra invoice created:", invoiceId);

      // Redirect to thank-you page with the Daftra invoice id
      return res.redirect(`${THANKYOU_URL}?invoice_id=${invoiceId}`);
    } catch (daftraErr) {
      logAxiosError("❌ Daftra invoice creation failed", daftraErr);
      // If invoice creation fails, still send user to error page (no invoice created)
      return res.redirect(`${ERROR_URL}?invoice_id=${orderId}`);
    }
  } catch (err) {
    logAxiosError("❌ payment-result verification failed", err);
    return res.redirect(`${ERROR_URL}?invoice_id=${orderId}`);
  }
});

/* =========================
   🚀 Start server
   ========================= */
app.listen(PORT, () => {
  console.log(`✅ Backend listening on http://localhost:${PORT}`);
});
