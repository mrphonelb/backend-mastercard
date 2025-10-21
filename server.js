require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment variables
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra API Key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   💳 1) Create Daftra Draft + Mastercard Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;

    if (!client_id || !total)
      return res.status(400).json({ error: "Missing client_id or total amount" });

    const baseTotal = Number(total);
    const fee = +(baseTotal * 0.035).toFixed(2);
    const paymentTotal = +(baseTotal + fee).toFixed(2);

    console.log(`🧾 Creating draft for client ${client_id} | Base $${baseTotal} | Fee $${fee}`);

    // ✅ Create Daftra Draft Invoice with actual cart items
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: `Draft created before Mastercard payment (Card Fee +3.5%)`
      },
      InvoiceItem: items.length
        ? items.map(i => ({
            item: i.item,
            description: i.description || "",
            unit_price: Number(i.unit_price),
            quantity: Number(i.quantity)
          }))
        : [
            {
              item: "Online Order",
              description: "Default order",
              unit_price: baseTotal,
              quantity: 1
            }
          ]
    };

    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      draftPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        }
      }
    );

    const draft = draftRes.data;
    if (!draft.id) throw new Error("Failed to create Daftra draft");
    console.log(`✅ Draft created: ${draft.id}`);

    // ✅ Create Mastercard Session using total + fee
    console.log(`💳 Creating MPGS session for DRAFT-${draft.id} | amount: $${paymentTotal}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: `DRAFT-${draft.id}`,
        amount: paymentTotal,
        currency,
        description: `Mr Phone LB - Draft ${draft.id}`
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com"
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/DRAFT-${draft.id}/${client_id}`,
        redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=${draft.id}`,
        retryAttemptCount: 2,
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE"
        }
      }
    };

    const mpgsRes = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    const mpgsData = mpgsRes.data;
    console.log("✅ MPGS session created:", mpgsData.session?.id);

    return res.json({
      ok: true,
      draft_id: draft.id,
      session: mpgsData.session,
      successIndicator: mpgsData.successIndicator
    });
  } catch (err) {
    console.error("❌ Error creating draft + session:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Daftra draft or Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💳 2) Verify Payment, Mark Paid, Create Payment Record
   ==================================================== */
app.get("/verify-payment/:orderId/:clientId", async (req, res) => {
  try {
    const { orderId, clientId } = req.params;
    const draftId = orderId.replace("DRAFT-", "");
    console.log(`🔍 Verifying MPGS payment for Draft ${draftId}`);

    const verifyRes = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    const orderData = verifyRes.data;
    const result = orderData.result;
    const status = orderData.order?.status || orderData.status;
    const amount = orderData.order?.amount || orderData.amount;

    if (result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED")) {
      console.log(`✅ Payment success for draft ${draftId}`);

      // ✅ 1. Mark draft as finalized
      await axios.put(
        `https://www.mrphonelb.com/api2/invoices/${draftId}`,
        {
          Invoice: {
            draft: false,
            notes: `✅ Mastercard payment confirmed. Total paid (incl. fees): $${amount}`
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

      // ✅ 2. Create payment record for that invoice
      await axios.post(
        "https://www.mrphonelb.com/api2/invoice-payments",
        {
          InvoicePayment: {
            invoice_id: draftId,
            amount: amount, // total actually charged (includes 3.5%)
            method: "Credit/Debit Card (Mastercard)",
            notes: "Online payment via Mastercard gateway (+3.5% card fee)"
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

      return res.redirect(
        `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draftId}`
      );
    }

    console.warn("⚠️ Payment failed or canceled:", { result, status });
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
  res.send("✅ MrPhone Backend Ready — Fixed draft amount, real items, and Daftra payment record.");
});

app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
