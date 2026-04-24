// =============================================================
// /api/bookeo-webhook.js (v2)
// Receives Bookeo webhooks, validates token, logs event,
// upserts customer and booking records.
//
// CHANGES from v1:
// - Event type now read from ?eventType= URL parameter (Bookeo
//   does not include event type in payload body or HTTP headers).
// - Captures X-Bookeo-MessageId header for deduplication and logs
//   it on the webhook_events row.
// - Updated payload parsing for actual Bookeo shape:
//   { item: {...booking fields...}, itemId, timestamp }
//   Customer is on item.customer; bookingId is itemId.
// - Idempotency check: if X-Bookeo-MessageId already processed,
//   short-circuit with 200 OK.
//
// Setup unchanged. Webhook URLs need to be registered with the
// new pattern: ?token=...&eventType=created (or updated/deleted).
// =============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const BOOKEO_API_BASE = 'https://api.bookeo.com/v2';

// =============================================================
// Helpers
// =============================================================

async function logWebhookEvent(eventType, payload, status, errorMessage = null, messageId = null) {
  try {
    const row = {
      source: 'bookeo',
      event_type: eventType,
      payload: messageId ? { ...payload, _messageId: messageId } : payload,
      processing_status: status,
      error_message: errorMessage,
    };
    const { data, error } = await supabase.from('webhook_events').insert([row]).select('id').single();
    if (error) console.error('webhook_events insert error:', error);
    return data?.id;
  } catch (err) {
    console.error('Failed to log webhook event:', err);
    return null;
  }
}

async function alreadyProcessed(messageId) {
  if (!messageId) return false;
  const { data } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('source', 'bookeo')
    .eq('processing_status', 'processed')
    .filter('payload->>_messageId', 'eq', messageId)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// Parse the booking customer block into upsert_customer fields.
function parseCustomer(c) {
  if (!c) return null;
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
    || c.displayName
    || null;
  const email = c.emailAddress || null;
  let phone = null;
  if (Array.isArray(c.phoneNumbers) && c.phoneNumbers.length > 0) {
    phone = c.phoneNumbers[0].number || null;
  }
  // Bookeo does not always provide DOB; tolerate missing.
  const dob = c.dateOfBirth || null;
  return { name, email, phone, dob };
}

function extractRoomName(item) {
  // Bookeo gives us productId and a title (often the customer name on
  // tour bookings). Prefer productName when present; fall back to a
  // truncated productId so we always have *something* readable.
  return item.productName
    || item.productId
    || (item.eventId ? item.eventId.split('_')[1] : null)
    || 'unknown';
}

// =============================================================
// Handlers
// =============================================================

async function handleBookingCreated(item, itemId) {
  if (!itemId) throw new Error('missing itemId');

  const parsed = parseCustomer(item.customer);

  // Build a customer record. Bookeo rarely sends DOB; substitute a
  // placeholder so the constraint is satisfied. The customer's first
  // waiver signature will overwrite the placeholder via upsert_customer.
  const dobForUpsert = parsed?.dob || '1900-01-01';
  const phoneForConstraint = parsed?.phone
    || (parsed?.email ? null : `placeholder_${itemId}`);

  let customerId = null;
  if (parsed && parsed.name && (parsed.email || parsed.phone)) {
    const { data, error } = await supabase.rpc('upsert_customer', {
      p_full_name: parsed.name,
      p_email: parsed.email,
      p_phone: parsed.phone,
      p_date_of_birth: dobForUpsert,
      p_is_minor: false,
      p_guardian_customer_id: null,
      p_acquisition_source: 'booking',
      p_marketing_email_opt_in: false,
      p_marketing_texts_opt_in: false,
      p_changed_via: 'bookeo_webhook',
    });
    if (error) throw new Error(`upsert_customer: ${error.message}`);
    customerId = data;
  } else {
    // Bookeo gave us nothing usable — create a true placeholder so the
    // booking row can still link to a customer FK.
    const { data: ph, error: phErr } = await supabase
      .from('customers')
      .insert([{
        full_name: parsed?.name || `Bookeo booking ${itemId}`,
        email: parsed?.email || null,
        phone: phoneForConstraint,
        date_of_birth: dobForUpsert,
        participant_type: 'booker_only',
        acquisition_source: 'booking',
        notes: 'Placeholder created from Bookeo webhook with incomplete customer data',
      }])
      .select('id').single();
    if (phErr) throw new Error(`placeholder customer: ${phErr.message}`);
    customerId = ph.id;
  }

  // Booking row
  const bookedFor = item.startTime || item.start || null;
  const participantCount =
    (Array.isArray(item.participants?.numbers)
      ? item.participants.numbers.reduce((s, p) => s + (p.number || 0), 0)
      : null)
    || item.numberOfParticipants
    || 1;

  const { error: bErr } = await supabase
    .from('bookeo_bookings')
    .upsert({
      bookeo_booking_id: String(itemId),
      room_name: extractRoomName(item),
      booked_for: bookedFor,
      primary_contact_customer_id: customerId,
      participant_count: participantCount,
      status: item.canceled ? 'canceled' : 'confirmed',
      raw_webhook_payload: item,
    }, { onConflict: 'bookeo_booking_id' });
  if (bErr) throw new Error(`booking upsert: ${bErr.message}`);

  return { customerId, bookeoBookingId: itemId };
}

async function handleBookingUpdated(item, itemId) {
  if (!itemId) throw new Error('missing itemId');

  const bookedFor = item.startTime || item.start || null;
  const participantCount =
    (Array.isArray(item.participants?.numbers)
      ? item.participants.numbers.reduce((s, p) => s + (p.number || 0), 0)
      : null)
    || item.numberOfParticipants
    || 1;

  // Use upsert in case the update arrives before we've seen a created event
  // (Bookeo guarantees ordering per booking, but defensive).
  const { error } = await supabase
    .from('bookeo_bookings')
    .upsert({
      bookeo_booking_id: String(itemId),
      room_name: extractRoomName(item),
      booked_for: bookedFor,
      participant_count: participantCount,
      status: item.canceled ? 'canceled' : 'confirmed',
      raw_webhook_payload: item,
    }, { onConflict: 'bookeo_booking_id' });
  if (error) throw new Error(`booking update: ${error.message}`);

  return { bookeoBookingId: itemId };
}

async function handleBookingDeleted(item, itemId) {
  if (!itemId) throw new Error('missing itemId');

  const { error } = await supabase
    .from('bookeo_bookings')
    .update({
      status: 'canceled',
      raw_webhook_payload: item,
    })
    .eq('bookeo_booking_id', String(itemId));
  if (error) throw new Error(`booking cancel: ${error.message}`);

  return { bookeoBookingId: itemId };
}

// =============================================================
// Main handler
// =============================================================

export default async function handler(req, res) {
  // Liveness check
  if (req.method === 'GET') {
    if (req.query.token === process.env.BOOKEO_WEBHOOK_TOKEN && req.query.ping) {
      return res.status(200).json({ ok: true, service: 'bookeo-webhook', version: 2 });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate token
  if (req.query.token !== process.env.BOOKEO_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Event type from URL param (Bookeo recommended pattern)
  const eventType = req.query.eventType || 'unknown';
  const messageId = req.headers['x-bookeo-messageid']
    || req.headers['x-bookeo-message-id']
    || null;
  const payload = req.body || {};

  // Idempotency: if we've already processed this messageId, ack and skip
  if (messageId && await alreadyProcessed(messageId)) {
    await logWebhookEvent(eventType, payload, 'duplicate_skipped', null, messageId);
    return res.status(200).json({ ok: true, duplicate: true, messageId });
  }

  // Log received
  await logWebhookEvent(eventType, payload, 'received', null, messageId);

  try {
    // Bookeo's actual payload shape: { item: {...}, itemId, timestamp }
    const item = payload.item || payload.booking || payload;
    const itemId = payload.itemId || item.bookingNumber || item.id;

    let result;
    switch (eventType) {
      case 'created':
        result = await handleBookingCreated(item, itemId);
        break;
      case 'updated':
        result = await handleBookingUpdated(item, itemId);
        break;
      case 'deleted':
      case 'canceled':
        result = await handleBookingDeleted(item, itemId);
        break;
      default:
        await logWebhookEvent(eventType, payload, 'ignored_unknown_type', null, messageId);
        return res.status(200).json({ ok: true, ignored: eventType });
    }

    await logWebhookEvent(eventType, payload, 'processed', null, messageId);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const msg = err?.message || String(err);
    await logWebhookEvent(eventType, payload, 'error', msg, messageId);
    // Return 200 so Bookeo doesn't retry-bomb while we debug
    return res.status(200).json({ ok: false, error: msg });
  }
}
