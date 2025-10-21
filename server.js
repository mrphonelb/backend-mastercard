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

// ✅ Daftra API key (static)
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   💳 1) Create Daftra Draft + Mastercard Session
==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;
    if (!client_id || !total)
      return res.status(400).json({ error: "Missing client_id or total amount" });

    // ✅ 1. Create Daftra draft first
    console.log(`🧾 Creating Daftra draft | client:${client_id} | total:$${total}`);

    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: "Draft created before Mastercard payment",
      },
      InvoiceItem: items.length
        ? items
        : [
            {
              item: "Online Order Payment",
              description: "Initial draft before Mastercard checkout",
              unit_price: total,
              quantity: 1,
            },
          ],
    };

    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      draftPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
        timeout: 15000,
      }
    );

    const draft = draftRes.data;
    if (!draft.id) throw new Error("Failed to create Daftra draft invoice");
    console.log(`✅ Daftra draft created: ${draft.id}`);

    // ✅ 2. Create Mastercard session using the draft ID
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: `DRAFT-${draft.id}`,
        amount: Number(total),
        currency,
        description: `Mr Phone LB - Draft ${draft.id}`,
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com",
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/DRAFT-${draft.id}/${client_id}`,
        redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=${draft.id}`,
        retryAttemptCount: 2,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" },
      },
    };

    const mpgsRes = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      }
    );

    const mpgsData = mpgsRes.data;
    console.log("✅ MPGS session created:", mpgsData.session?.id);

    return res.json({
      ok: true,
      draft_id: draft.id,
      session: mpgsData.session,
      successIndicator: mpgsData.successIndicator,
    });
  } catch (err) {
    console.error(
      "❌ Error creating draft + session:",
      err.response?.data || err.message
    );
    return res.status(500).json({
      error: "Failed to create Daftra draft or Mastercard session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   💳 2) Verify Payment, Mark Draft Paid, Redirect
==================================================== */
app.get("/verify-payment/:orderId/:clientId", async (req, res) => {
  try {
    const { orderId, clientId } = req.params;
    const draftId = orderId.replace("DRAFT-", "");
    console.log(`🔍 Verifying payment for Draft ${draftId}`);

    // ✅ Check payment status from Mastercard
    const orderResp = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      }
    );

    const data = orderResp.data;
    const result = data.result;
    const status = data.order?.status || data.status;
    const amount = data.order?.amount || data.amount;

    console.log("ℹ️ MPGS verify result:", { result, status, amount });

    // ✅ On Success
    if (result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED")) {
      console.log(`✅ Payment success for draft ${draftId}`);

      // Mark Daftra draft as finalized (not draft anymore)
      await axios.put(
        `https://www.mrphonelb.com/api2/invoices/${draftId}`,
        {
          Invoice: {
            notes: `✅ Payment confirmed via Mastercard for draft ${draftId}`,
            draft: false,
          },
        },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            apikey: DAFTRA_API_KEY,
          },
          timeout: 15000,
        }
      );

      // ✅ Redirect to thank-you page
      return res.redirect(
        `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftId}`
      );
    }

    // ❌ On Failure / Cancel
    console.warn("⚠️ Payment not successful:", { result, status });
    return res.redirect(
      `https://www.mrphonelb.com/client/contents/error?invoice_id=${draftId}`
    );
  } catch (err) {
    console.error("❌ Verify error:", err.response?.data || err.message);
    return res.redirect(
      "https://www.mrphonelb.com/client/contents/error?invoice_id=unknown"
    );
  }
});

/* ====================================================
   🧠 3) Health Check
==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready — Daftra Draft + Mastercard Integration (vFinal).");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
