# Testing Your Stripe Webhook

## 🔍 **Why Your Webhook Wasn't Working**

Your `stripe-webhook` file was **completely empty** - that's why it wasn't working! I've recreated it with comprehensive logging.

## 🚀 **Steps to Test Your Webhook**

### 1. **Deploy the Updated Webhook**
1. Deploy the updated `stripe-webhook` function to Supabase
2. Make sure it's active and accessible

### 2. **Check Your Stripe Webhook Configuration**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers** → **Webhooks**
3. Find your webhook endpoint (should point to your Supabase function)
4. Click on it and check:
   - **Endpoint URL**: Should be `https://your-project.supabase.co/functions/v1/stripe-webhook`
   - **Events**: Should include at least `checkout.session.completed`
   - **Status**: Should show "Active"

### 3. **Test with a Real Payment**
1. Create a test booking in your app
2. Complete the payment flow
3. Check **Supabase Function Logs** for webhook activity
4. Check **Stripe Dashboard** → **Webhooks** → **Events** tab

### 4. **Check Supabase Function Logs**
1. Go to Supabase Dashboard
2. **Edge Functions** → **stripe-webhook**
3. Click **Logs** tab
4. Look for logs like:
   ```
   🔄 Webhook received: {method: "POST", url: "...", headers: {...}}
   📦 Request body length: 1234
   🔐 Stripe signature present: true
   🔑 Webhook secret configured: true
   ✅ Webhook signature verified successfully
   📋 Event type: checkout.session.completed
   🆔 Event ID: evt_xxx
   ```

## 🧪 **Manual Webhook Testing**

### **Option 1: Use Stripe CLI (Recommended)**
```bash
# Install Stripe CLI
# Then run:
stripe listen --forward-to https://your-project.supabase.co/functions/v1/stripe-webhook

# In another terminal, trigger a test event:
stripe trigger checkout.session.completed
```

### **Option 2: Test from Stripe Dashboard**
1. Go to your webhook in Stripe Dashboard
2. Click **Send test webhook**
3. Select `checkout.session.completed`
4. Click **Send test webhook**
5. Check your Supabase logs

## 🔧 **Common Issues & Solutions**

### **Issue 1: "Webhook not receiving events"**
**Check:**
- Webhook endpoint URL is correct
- Webhook is active in Stripe
- Your Supabase function is deployed and accessible
- No firewall/network blocking

### **Issue 2: "Signature verification failed"**
**Check:**
- `STRIPE_WEBHOOK_SECRET` environment variable is set in Supabase
- Webhook secret matches what's in Stripe Dashboard
- Secret is copied correctly (no extra spaces)

### **Issue 3: "Function not found"**
**Check:**
- Function is deployed to Supabase
- Function name matches the URL
- Function is active and not paused

### **Issue 4: "Database errors"**
**Check:**
- `stripe_payment_info` table exists
- Service role key has proper permissions
- Table structure matches your schema

## 📊 **What to Look For in Logs**

### **Successful Webhook:**
```
🔄 Webhook received: {method: "POST", url: "...", headers: {...}}
📦 Request body length: 1234
🔐 Stripe signature present: true
🔑 Webhook secret configured: true
✅ Webhook signature verified successfully
📋 Event type: checkout.session.completed
🆔 Event ID: evt_xxx
🎯 Processing webhook event: checkout.session.completed
💳 Processing checkout.session.completed
🔄 Processing completed checkout session: cs_xxx
📋 Session data: {id: "cs_xxx", customer: "cus_xxx", ...}
✅ Payment info updated successfully
✅ Booking status updated to Confirmed
✅ Successfully processed checkout session completion
✅ Webhook processed successfully
```

### **Failed Webhook:**
```
❌ Missing Stripe signature or webhook secret
❌ Webhook signature verification failed: ...
❌ Failed to update payment info: ...
❌ Failed to update booking status: ...
💥 Error handling checkout session completion: ...
```

## 🎯 **Next Steps After Testing**

1. **If webhook works**: Great! Monitor logs for any errors
2. **If webhook fails**: Check the specific error messages in logs
3. **If no webhook calls**: Verify Stripe configuration and endpoint URL
4. **If database errors**: Check table structure and permissions

## 🔍 **Monitoring Ongoing Webhook Health**

### **Check Supabase Logs Regularly:**
- Look for webhook function calls
- Monitor for any error patterns
- Verify successful payment processing

### **Check Stripe Dashboard:**
- Webhook delivery success rate
- Response times
- Any failed webhook attempts

### **Test Periodically:**
- Send test webhooks from Stripe Dashboard
- Verify logs show successful processing
- Check that database records are updated

---

**Remember**: Webhooks are crucial for keeping your payment data in sync. Always test thoroughly and monitor for any issues!



