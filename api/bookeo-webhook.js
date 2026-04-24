// =============================================================
// /api/bookeo-webhook.js
// Receives Bookeo webhooks (booking.created, booking.updated,
// booking.canceled), validates token, logs event, upserts
// customer and booking records.
//
// Setup:
// 1. Place this file at /api/bookeo-webhook.js in the React repo
// 2. Add these environment variables in Vercel:
//      BOOKEO_WEBHOOK_TOKEN  — the secret token in the URL path
//      BOOKEO_API_KEY        — for outbound calls to Bookeo
//      BOOKEO_SECRET_KEY     — for outbound calls to Bookeo
//      SUPABASE_URL          — https://wtspmrqnatbnexinspzb.supabase.co
//      SUPABASE_SERVICE_KEY  — service_role key (NOT anon) for writes
// 3. After deploy, webhook URL is:
//      https://react-waiver.vercel.app/api/bookeo-webhook?token=<BOOKEO_WEBHOOK_TOKEN>
// 4. Register this URL in Bookeo → Apps & API → Webhooks
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

async function logWebhookEvent(eventType, payload, status, errorMessage = null) {
  try {
    await supabase.from('webhook_events').insert([{
      source: 'bookeo',
      event_type: eventType,
      payload: payload,
      processing_status: status,
      error_message: errorMessage,
    }]);
  } catch (err) {
    console.error('Failed to log webhook event:', err);
  }
}

async function bookeoApiGet(path) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${BOOKEO_API_BASE}${path}${separator}apiKey=${process.env.BOOKEO_API_KEY}&secretKey=${process.env.BOOKEO_SECRET_KEY}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bookeo API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Derive a single readable room name from a booking payload.
// Bookeo bookings reference a productId; we attempt to use the
// productName if the webhook/fetch provides it, else fall back.
function extractRoomName(booking) {
  return booking.productName
    || booking.title
    || booking.eventId?.split('_')?.[0]
    || 'unknown';
}

// Parse Bookeo's "customer" payload shape into fields our upsert_customer
// function expects. Bookeo sends firstName/lastName separately; we
// combine. Phone is "phoneNumbers": [{number, type}].
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
  const dob = c.dateOfBirth || null; // 'YYYY-MM-DD' if Bookeo has it
  return { name, email, phone, dob };
}

// =============================================================
// Handlers per event type
// =============================================================

async function handleBookingCreated(booking) {
  const bookeoBookingId = booking.bookingNumber || booking.id;
  if (!bookeoBookingId) throw new Error('missing booking id in payload');

  // 1. Resolve the booker's customer info.
  // Bookeo sometimes inlines customer data, sometimes requires a follow-up fetch.
  let customer = booking.customer;
  if (!customer && booking.customerId) {
    try {
      customer = await bookeoApiGet(`/customers/${booking.customerId}`);
    } catch (err) {
      // Non-fatal — we can still store the booking with a minimal customer record
      console.warn('Could not fetch customer:', err.message);
    }
  }

  const parsed = parseCustomer(customer);

  // 2. Upsert the customer record (booker_only if first contact).
  let customerId = null;
  if (parsed && parsed.name && (parsed.email || parsed.phone) && parsed.dob) {
    const { data, error } = await supabase.rpc('upsert_customer', {
      p_full_name: parsed.name,
      p_email: parsed.email,
      p_phone: parsed.phone,
      p_date_of_birth: parsed.dob,
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
    // We can't satisfy the customers table constraints (DOB required,
    // at least one of email/phone required). Skip customer creation;
    // the booking row will have primary_contact_customer_id = null
    // handled below by creating a placeholder.
    console.warn('Incomplete customer data from Bookeo; creating placeholder.');
    const { data: placeholder, error: phErr } = await supabase
      .from('customers')
      .insert([{
        full_name: parsed?.name || 'Unknown Booker',
        email: parsed?.email || null,
        phone: parsed?.phone || `placeholder_${bookeoBookingId}`, // satisfy at-least-one constraint
        date_of_birth: parsed?.dob || '1900-01-01', // placeholder DOB; will be updated when they sign a waiver
        participant_type: 'booker_only',
        acquisition_source: 'booking',
        notes: 'Placeholder — Bookeo did not provide DOB. Updated on first waiver signature.',
      }])
      .select('id')
      .single();
    if (phErr) throw new Error(`placeholder customer: ${phErr.message}`);
    customerId = placeholder.id;
  }

  // 3. Insert the bookeo_bookings row (idempotent via bookeo_booking_id unique constraint).
  const bookedFor = booking.startTime || booking.start || null;
  const participantCount = booking.numberOfParticipants
    || booking.participants?.numbers?.reduce((sum, p) => sum + (p.number || 0), 0)
    || 1;

  const { error: bookingError } = await supabase
    .from('bookeo_bookings')
    .upsert(
      {
        bookeo_booking_id: String(bookeoBookingId),
        room_name: extractRoomName(booking),
        booked_for: bookedFor,
        primary_contact_customer_id: customerId,
        participant_count: participantCount,
        status: 'confirmed',
        raw_webhook_payload: booking,
      },
      { onConflict: 'bookeo_booking_id' }
    );
  if (bookingError) throw new Error(`booking upsert: ${bookingError.message}`);

  return { customerId, bookeoBookingId };
}

async function handleBookingUpdated(booking) {
  const bookeoBookingId = booking.bookingNumber || booking.id;
  if (!bookeoBookingId) throw new Error('missing booking id in payload');

  const bookedFor = booking.startTime || booking.start || null;
  const participantCount = booking.numberOfParticipants
    || booking.participants?.numbers?.reduce((sum, p) => sum + (p.number || 0), 0)
    || 1;

  const { error } = await supabase
    .from('bookeo_bookings')
    .update({
      room_name: extractRoomName(booking),
      booked_for: bookedFor,
      participant_count: participantCount,
      raw_webhook_payload: booking,
    })
    .eq('bookeo_booking_id', String(bookeoBookingId));
  if (error) throw new Error(`booking update: ${error.message}`);

  return { bookeoBookingId };
}

async function handleBookingCanceled(booking) {
  const bookeoBookingId = booking.bookingNumber || booking.id;
  if (!bookeoBookingId) throw new Error('missing booking id in payload');

  const { error } = await supabase
    .from('bookeo_bookings')
    .update({
      status: 'canceled',
      raw_webhook_payload: booking,
    })
    .eq('bookeo_booking_id', String(bookeoBookingId));
  if (error) throw new Error(`booking cancel: ${error.message}`);

  return { bookeoBookingId };
}

// =============================================================
// Main handler
// =============================================================

export default async function handler(req, res) {
  // CORS / method check
  if (req.method === 'GET') {
    // Allow a quick liveness check: /api/bookeo-webhook?token=...&ping=1
    if (req.query.token === process.env.BOOKEO_WEBHOOK_TOKEN && req.query.ping) {
      return res.status(200).json({ ok: true, service: 'bookeo-webhook' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate token in URL
  if (req.query.token !== process.env.BOOKEO_WEBHOOK_TOKEN) {
    // Do NOT log the attempt with payload — could be a noisy attacker
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body || {};
  const eventType = payload.event || payload.type || 'unknown';

  // Log event as received before processing
  await logWebhookEvent(eventType, payload, 'received');

  try {
    // Bookeo's webhook payload shape varies by event. Common fields:
    // { event: 'booking.created' | 'booking.updated' | 'booking.canceled',
    //   booking: { ... } }
    // Some tenants send the booking fields at the top level. Handle both.
    const booking = payload.booking || payload;

    let result;
    switch (eventType) {
      case 'booking.created':
      case 'booking.new':
        result = await handleBookingCreated(booking);
        break;
      case 'booking.updated':
      case 'booking.changed':
        result = await handleBookingUpdated(booking);
        break;
      case 'booking.canceled':
      case 'booking.cancelled':
      case 'booking.deleted':
        result = await handleBookingCanceled(booking);
        break;
      default:
        // Unknown event — log and accept so Bookeo doesn't retry.
        await logWebhookEvent(eventType, payload, 'ignored_unknown_type');
        return res.status(200).json({ ok: true, ignored: eventType });
    }

    await logWebhookEvent(eventType, payload, 'processed');
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const msg = err?.message || String(err);
    await logWebhookEvent(eventType, payload, 'error', msg);
    // Return 200 to prevent Bookeo from retry-bombing us while we debug.
    // We can see the error in the webhook_events table.
    return res.status(200).json({ ok: false, error: msg });
  }
}
