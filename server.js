require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ ENV variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra credentials
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   1️⃣ CREATE MASTERCARD SESSION (redirect payment)
==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items, total, currency = "USD" } = req.body;

    if (!client_id || !items?.length || !total) {
      return res.status(400).json({ error: "Missing client_id, items, or total" });
    }

    const gatewayTotal = (Number(total) * 1.035).toFixed(2); // +3.5% for payment gateway
    console.log(`💳 Create Mastercard session | Client:${client_id} | Total:${total} | Gateway:$${gatewayTotal}`);

    // Create Daftra draft now (original total only)
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: "Draft created via Mastercard checkout (before payment)",
      },
      InvoiceItem: items,
    };

    const draftRes = await axios.post("https://www.mrphonelb.com/api2/invoices", draftPayload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY,
      },
    });

    const draft = draftRes.data;
    if (!draft.id) throw new Error("❌ Failed to create Daftra draft invoice");

    console.log(`✅ Daftra draft created: ${draft.id}`);

    // Create Mastercard session
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      order: {
        id: `DRAFT-${draft.id}`,
        amount: Number(gatewayTotal),
        currency,
        description: `Mr Phone LB Draft ${draft.id}`,
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/DRAFT-${draft.id}/${client_id}/${total}`,
        displayControl: { billingAddress: "HIDE" },
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
      }
    );

    const mpgsData = mpgsRes.data;
    console.log("✅ MPGS session created:", mpgsData.session?.id);

    res.json({
      ok: true,
      draft_id: draft.id,
      session: mpgsData.session,
      successIndicator: mpgsData.successIndicator,
    });
  } catch (err) {
    console.error("❌ Error creating session:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   2️⃣ VERIFY PAYMENT + CREATE PAYMENT RECORD
==================================================== */
app.get("/verify-payment/:orderId/:clientId/:total", async (req, res) => {
  try {
    const { orderId, clientId, total } = req.params;
    const draftId = orderId.replace("DRAFT-", "");
    console.log(`🔍 Verify payment for draft ${draftId}`);

    // Check payment status
    const orderResp = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
      }
    );

    const result = orderResp.data.result;
    const status = orderResp.data.order?.status;
    const transaction_id = orderResp.data.transaction?.id || orderResp.data.order?.id;

    if (result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED")) {
      console.log(`✅ Payment success | Draft:${draftId} | Txn:${transaction_id}`);

      // Create Daftra pending payment (same amount as original)
      const paymentPayload = {
        InvoicePayment: {
          invoice_id: Number(draftId),
          payment_method: "Credit___Debit_Card",
          amount: Number(total),
          transaction_id: transaction_id,
          status: 0, // pending
          notes: "Pending verification (Mastercard)",
          currency_code: "USD",
        },
      };

      await axios.post("https://www.mrphonelb.com/api2/invoice_payments", paymentPayload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
      });

      console.log("💰 Pending payment recorded in Daftra");

      // ✅ Redirect to thank-you page
      return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftId}`);
    } else {
      console.warn("⚠️ Payment not successful");
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${draftId}`);
    }
  } catch (err) {
    console.error("❌ Verify-payment error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ====================================================
   🧠 HEALTH CHECK
==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Mastercard backend running successfully.");
});

app.listen(PORT, () => {
  console.log(`🚀 MrPhone backend running on port ${PORT}`);
});
