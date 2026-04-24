import { useState, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://wtspmrqnatbnexinspzb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0c3BtcnFuYXRibmV4aW5zcHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzEzOTUsImV4cCI6MjA4NzYwNzM5NX0.OYC11RHMHiUTRoKzVJQxFkO656bXZDAaQbz6j6XTAZ0'
);

const LOGO_URL = 'https://static.wixstatic.com/media/bbef2a_e5182ebf7aa047b99c23c4c98fec29db~mv2.png/v1/fill/w_276,h_110,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/HD%2520Logo-Transparent%2520BG-01_edited.png';

const ADMIN_PASSWORD = 'Admin';

// ============================================================
// PHASE 3 WAIVER FORM
// Changes from v1:
//  - DOB (MM/YY) required for all
//  - Minor flow collects guardian DOB + minor DOB
//  - Optional booking code field (MM-DD-HHMM) for fallback linking
//  - Writes to waivers_v2 (not legacy Waivers table)
//  - Uses upsert_customer RPC + match_customer to link to booking
// ============================================================

// Month dropdown options
const MONTHS = [
  { v: '01', l: '01 — Jan' }, { v: '02', l: '02 — Feb' }, { v: '03', l: '03 — Mar' },
  { v: '04', l: '04 — Apr' }, { v: '05', l: '05 — May' }, { v: '06', l: '06 — Jun' },
  { v: '07', l: '07 — Jul' }, { v: '08', l: '08 — Aug' }, { v: '09', l: '09 — Sep' },
  { v: '10', l: '10 — Oct' }, { v: '11', l: '11 — Nov' }, { v: '12', l: '12 — Dec' },
];

// Year dropdown: current year back to 100 years ago
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 101 }, (_, i) => {
  const y = CURRENT_YEAR - i;
  return { v: String(y).slice(-2), l: String(y) };
});

// Convert MM + YY -> YYYY-MM-01 (date string for Postgres date column)
const buildDobDate = (mm, yy) => {
  if (!mm || !yy) return null;
  const yyyy = Number(yy) > 30 ? `19${yy}` : `20${yy}`;
  return `${yyyy}-${mm}-01`;
};

// Parse MM-DD-HHMM booking code -> { datePart, startISO } for lookup
// e.g. "04-26-1930" -> start time on April 26 at 19:30 in current year
const parseBookingCode = (code) => {
  const clean = (code || '').trim();
  const m = clean.match(/^(\d{2})-(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, hh, mn] = m;
  // Assume current year. If current date is past this MM-DD by more than 60 days,
  // assume next year instead (handles Dec bookings signed in Jan edge case).
  const tryDate = new Date(`${CURRENT_YEAR}-${mm}-${dd}T${hh}:${mn}:00`);
  const now = new Date();
  const diffDays = (now - tryDate) / (1000 * 60 * 60 * 24);
  let year = CURRENT_YEAR;
  if (diffDays > 60) year = CURRENT_YEAR + 1;
  return {
    mm, dd, hh, mn,
    startISO: `${year}-${mm}-${dd}T${hh}:${mn}:00`,
  };
};

function WaiverForm() {
  // Signer fields (adult or guardian)
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');

  // Minor fields (only if isMinor)
  const [isMinor, setIsMinor] = useState(false);
  const [minorName, setMinorName] = useState('');
  const [minorDobMonth, setMinorDobMonth] = useState('');
  const [minorDobYear, setMinorDobYear] = useState('');

  // Optional fallback linking
  const [bookingCode, setBookingCode] = useState('');

  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
  const isDrawing = useRef(false);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#00bfff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const endDraw = (e) => {
    e.preventDefault();
    isDrawing.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const isCanvasBlank = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return !data.some((channel, i) => i % 4 !== 3 ? false : channel !== 0);
  };

  // Resolve booking_id from booking code (if provided).
  // Returns { bookingId, method } where method is 'booking_code' or 'unlinked' or 'invalid_code'
  const resolveBookingByCode = async (code) => {
    if (!code || !code.trim()) return { bookingId: null, method: null };
    const parsed = parseBookingCode(code);
    if (!parsed) return { bookingId: null, method: 'invalid_code' };

    // Query bookings where booked_for falls within the same minute as the code.
    // Use a 2-minute window to absorb timezone/second drift.
    const start = new Date(parsed.startISO);
    const winStart = new Date(start.getTime() - 60 * 1000).toISOString();
    const winEnd = new Date(start.getTime() + 60 * 1000).toISOString();

    const { data, error: qErr } = await supabase
      .from('bookeo_bookings')
      .select('id')
      .gte('booked_for', winStart)
      .lte('booked_for', winEnd)
      .limit(1);

    if (qErr || !data || data.length === 0) return { bookingId: null, method: 'invalid_code' };
    return { bookingId: data[0].id, method: 'code_entry' };
  };

  // Try webhook-primed match via 2-of-4 (name + email + dob; phone not collected).
  // Returns booking_id if the matched customer has exactly one confirmed booking.
  const resolveBookingByMatch = async (customerId) => {
    if (!customerId) return null;
    const { data, error: qErr } = await supabase
      .from('bookeo_bookings')
      .select('id')
      .eq('primary_contact_customer_id', customerId)
      .eq('status', 'confirmed')
      .order('booked_for', { ascending: false })
      .limit(1);
    if (qErr || !data || data.length === 0) return null;
    return data[0].id;
  };

  // Upsert a customer via RPC. Returns customer UUID on success.
  const upsertCustomer = async ({ name, email, dob, isMinorFlag, guardianId }) => {
    const payload = {
      p_full_name: name,
      p_email: email || null,
      p_phone: null, // not collected on this form
      p_date_of_birth: dob,
      p_is_minor: !!isMinorFlag,
      p_guardian_customer_id: guardianId || null,
      p_acquisition_source: 'waiver',
      p_changed_via: 'waiver_v2',
    };
    const { data, error: rpcErr } = await supabase.rpc('upsert_customer', payload);
    if (rpcErr) {
      console.error('upsert_customer RPC failed:', rpcErr);
      throw new Error('Could not save your info. Please try again or contact staff.');
    }
    return data; // expected to be a UUID string
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!fullName.trim() || !email.trim()) {
      setError('Please fill in your name and email.');
      return;
    }
    if (!dobMonth || !dobYear) {
      setError('Please enter your date of birth (MM/YY).');
      return;
    }
    if (isMinor) {
      if (!minorName.trim()) {
        setError("Please enter the minor's name.");
        return;
      }
      if (!minorDobMonth || !minorDobYear) {
        setError("Please enter the minor's date of birth (MM/YY).");
        return;
      }
    }
    if (bookingCode.trim() && !/^\d{2}-\d{2}-\d{4}$/.test(bookingCode.trim())) {
      setError('Booking code must be in MM-DD-HHMM format (e.g., 04-26-1930).');
      return;
    }
    if (!agreed) {
      setError('You must agree to the waiver terms.');
      return;
    }
    if (isCanvasBlank()) {
      setError('Please provide your signature.');
      return;
    }

    setLoading(true);

    try {
      const signatureDataUrl = canvasRef.current.toDataURL('image/png');
      const signerDob = buildDobDate(dobMonth, dobYear);
      const minorDob = isMinor ? buildDobDate(minorDobMonth, minorDobYear) : null;

      // Step 1: Upsert the signer (adult or guardian).
      const signerCustomerId = await upsertCustomer({
        name: fullName.trim(),
        email: email.trim(),
        dob: signerDob,
        isMinorFlag: false,
        guardianId: null,
      });

      // Step 2: If minor, upsert the minor linked to the signer as guardian.
      let minorCustomerId = null;
      if (isMinor) {
        minorCustomerId = await upsertCustomer({
          name: minorName.trim(),
          email: null, // minors don't have email here
          dob: minorDob,
          isMinorFlag: true,
          guardianId: signerCustomerId,
        });
      }

      // Step 3: Resolve booking link.
      //   Priority 1: booking code (if provided and valid)
      //   Priority 2: 2-of-4 customer match -> find their confirmed booking
      //   Fallback:   unlinked (staff can link manually later)
      let bookingId = null;
      let linkMethod = 'unlinked';

      const codeResult = await resolveBookingByCode(bookingCode);
      if (codeResult.method === 'code_entry') {
        bookingId = codeResult.bookingId;
        linkMethod = 'code_entry';
      } else if (codeResult.method === 'invalid_code') {
        // Code was provided but didn't match — don't silently drop, just fall through to match.
        // We still attempt webhook match below.
      }

      if (!bookingId) {
        const matched = await resolveBookingByMatch(signerCustomerId);
        if (matched) {
          bookingId = matched;
          linkMethod = 'webhook';
        }
      }

      // Step 4: Insert the waiver into waivers_v2.
      // waivers_v2 is intentionally lean — personal data lives on the customers table.
      // The customer_id is: minor's id if this is a minor waiver, signer's id otherwise.
      // Guardian linkage is tracked on the customers table (minor.guardian_customer_id).
      const waiverRow = {
        customer_id: isMinor ? minorCustomerId : signerCustomerId,
        booking_id: bookingId,
        booking_link_method: linkMethod,
        agreed_at: new Date().toISOString(),
        signature_url: signatureDataUrl,
      };

      const { error: dbError } = await supabase.from('waivers_v2').insert([waiverRow]);
      if (dbError) throw dbError;

      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />
          <div style={styles.successIcon}>✓</div>
          <h2 style={styles.successTitle}>Waiver Signed!</h2>
          <p style={styles.successText}>
            Thank you, {fullName}. Your waiver has been submitted.
            {isMinor && <><br />Minor: {minorName}</>}
          </p>
          <p style={styles.successSubtext}>You're all set for your adventure.</p>
          <button
            onClick={() => {
              setSubmitted(false);
              setFullName('');
              setEmail('');
              setDobMonth('');
              setDobYear('');
              setIsMinor(false);
              setMinorName('');
              setMinorDobMonth('');
              setMinorDobYear('');
              setBookingCode('');
              setAgreed(false);
              clearSignature();
            }}
            style={styles.button}
          >
            Sign Another Waiver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />

        <h1 style={styles.title}>Participant Waiver</h1>
        <p style={styles.subtitle}>
          Please complete this waiver before your adventure.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your full name"
            style={styles.input}
          />

          <label style={styles.label}>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            style={styles.input}
          />

          <label style={styles.label}>Date of Birth (MM / YY)</label>
          <div style={styles.dobRow}>
            <select
              value={dobMonth}
              onChange={(e) => setDobMonth(e.target.value)}
              style={{ ...styles.input, ...styles.dobSelect }}
            >
              <option value="">MM</option>
              {MONTHS.map((m) => (
                <option key={m.v} value={m.v}>{m.l}</option>
              ))}
            </select>
            <select
              value={dobYear}
              onChange={(e) => setDobYear(e.target.value)}
              style={{ ...styles.input, ...styles.dobSelect }}
            >
              <option value="">YY</option>
              {YEARS.map((y) => (
                <option key={y.v} value={y.v}>{y.l}</option>
              ))}
            </select>
          </div>

          <div style={styles.checkboxRow}>
            <input
              type="checkbox"
              id="minor-check"
              checked={isMinor}
              onChange={(e) => {
                setIsMinor(e.target.checked);
                if (!e.target.checked) {
                  setMinorName('');
                  setMinorDobMonth('');
                  setMinorDobYear('');
                }
              }}
              style={styles.checkbox}
            />
            <label htmlFor="minor-check" style={styles.checkboxLabel}>
              I am signing on behalf of a minor (under 18)
            </label>
          </div>

          {isMinor && (
            <>
              <label style={styles.label}>Minor's Full Name</label>
              <input
                type="text"
                value={minorName}
                onChange={(e) => setMinorName(e.target.value)}
                placeholder="Enter the minor's full name"
                style={styles.input}
              />

              <label style={styles.label}>Minor's Date of Birth (MM / YY)</label>
              <div style={styles.dobRow}>
                <select
                  value={minorDobMonth}
                  onChange={(e) => setMinorDobMonth(e.target.value)}
                  style={{ ...styles.input, ...styles.dobSelect }}
                >
                  <option value="">MM</option>
                  {MONTHS.map((m) => (
                    <option key={m.v} value={m.v}>{m.l}</option>
                  ))}
                </select>
                <select
                  value={minorDobYear}
                  onChange={(e) => setMinorDobYear(e.target.value)}
                  style={{ ...styles.input, ...styles.dobSelect }}
                >
                  <option value="">YY</option>
                  {YEARS.map((y) => (
                    <option key={y.v} value={y.v}>{y.l}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <label style={styles.label}>Booking Code (optional)</label>
          <input
            type="text"
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value)}
            placeholder="MM-DD-HHMM (only if staff asked you to)"
            style={styles.input}
          />
          <p style={styles.helperText}>
            Leave blank unless a staff member gave you a code. Your waiver will still link to your booking automatically.
          </p>

          <div style={styles.waiverBox}>
            <p style={styles.waiverText}>
              By signing this waiver, I acknowledge and agree to the following terms as a
              condition of participating in any activity at REACT Premium Escape Rooms, owned
              and operated by B.R. Entertainment LLC, on behalf of myself and any members of
              my group:
              <br /><br />
              I will comply with all rules, regulations, and instructions issued by REACT
              staff during my visit.
              <br /><br />
              I accept financial responsibility for any damages caused by negligent or
              reckless actions by myself or members of my group.
              <br /><br />
              I release and hold harmless REACT Premium Escape Rooms, B.R. Entertainment LLC,
              and their owners, employees, and agents from any and all liability arising from
              my use of or presence upon their facilities.
              <br /><br />
              I have read this Release of Liability, assume all risks associated with
              participation, and sign voluntarily and without inducement.
              {isMinor && (
                <><br /><br />
                As the parent, guardian, or representative of the minor named above, I certify
                that I am authorized to sign on their behalf and accept responsibility for
                their participation.</>
              )}
            </p>
          </div>

          <div style={styles.checkboxRow}>
            <input
              type="checkbox"
              id="agree-check"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={styles.checkbox}
            />
            <label htmlFor="agree-check" style={styles.checkboxLabel}>
              I have read and agree to the waiver terms above
            </label>
          </div>

          <label style={styles.label}>Signature</label>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
            style={styles.canvas}
          />
          <button type="button" onClick={clearSignature} style={styles.clearBtn}>
            Clear Signature
          </button>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={{
            ...styles.button,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? 'Submitting...' : 'Submit Waiver'}
          </button>
        </form>

        <p style={styles.footer}>
          REACT Premium Escape Rooms · 1 Corporate Dr, Suite 102, Windsor Locks, CT 06096
        </p>
      </div>
    </div>
  );
}

// ============================================================
// GENERIC TABLE TAB — used for the new tables (read-only)
// ============================================================
function GenericTableTab({ tableName, columns, orderBy = 'created_at', orderAsc = false, searchFields = [] }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  const fetchRows = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: dbError } = await supabase
        .from(tableName)
        .select('*')
        .order(orderBy, { ascending: orderAsc });

      if (dbError) throw dbError;
      setRows(data || []);
    } catch (err) {
      setError('Failed to load ' + tableName + '.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = rows.filter((row) => {
    if (!search) return true;
    if (searchFields.length === 0) return true;
    const q = search.toLowerCase();
    return searchFields.some((field) =>
      String(row[field] || '').toLowerCase().includes(q)
    );
  });

  const formatCell = (value, type) => {
    if (value === null || value === undefined) return <span style={admin.nullCell}>—</span>;
    if (type === 'date') return new Date(value).toLocaleString();
    if (type === 'bool') return value ? 'Yes' : 'No';
    if (type === 'json') return <span style={admin.jsonCell}>{JSON.stringify(value).slice(0, 60)}...</span>;
    if (typeof value === 'string' && value.length > 60) return value.slice(0, 60) + '...';
    return String(value);
  };

  return (
    <div>
      <div style={admin.tabHeader}>
        <p style={admin.tabCount}>
          {rows.length} row{rows.length !== 1 ? 's' : ''}
        </p>
        <button onClick={fetchRows} style={admin.refreshBtn}>↻ Refresh</button>
      </div>

      {searchFields.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={'Search ' + searchFields.join(', ') + '...'}
          style={{ ...styles.input, marginBottom: '12px' }}
        />
      )}

      {loading && <p style={admin.statusText}>Loading...</p>}
      {error && <p style={styles.error}>{error}</p>}

      {!loading && filtered.length === 0 && (
        <p style={admin.statusText}>
          {search ? 'No matching rows.' : 'No rows yet. This table will populate as the system is used.'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div style={admin.tableWrap}>
          <table style={admin.table}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} style={admin.th}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} style={admin.tr}>
                  {columns.map((col) => (
                    <td key={col.key} style={admin.td}>
                      {formatCell(row[col.key], col.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// WAIVERS TAB — legacy Waivers table (read-only archive)
// ============================================================
function WaiversTab() {
  const [waivers, setWaivers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedWaiver, setSelectedWaiver] = useState(null);

  useEffect(() => {
    fetchWaivers();
  }, []);

  const fetchWaivers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: dbError } = await supabase
        .from('Waivers')
        .select('*')
        .order('created_at', { ascending: false });

      if (dbError) throw dbError;
      setWaivers(data || []);
    } catch (err) {
      setError('Failed to load waivers.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = waivers.filter((w) => {
    const q = search.toLowerCase();
    return (
      (w.full_name || '').toLowerCase().includes(q) ||
      (w.email || '').toLowerCase().includes(q) ||
      (w.minor_name || '').toLowerCase().includes(q)
    );
  });

  const exportCSV = () => {
    const headers = ['Date', 'Full Name', 'Email', 'Minor', 'Minor Name'];
    const rows = filtered.map((w) => [
      new Date(w.created_at).toLocaleDateString(),
      w.full_name || '',
      w.email || '',
      w.is_minor ? 'Yes' : 'No',
      w.minor_name || '',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'react-waivers-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (selectedWaiver) {
    return (
      <div>
        <div style={admin.headerRow}>
          <h2 style={{ ...styles.title, textAlign: 'left', margin: 0 }}>Waiver Details</h2>
          <button onClick={() => setSelectedWaiver(null)} style={admin.backBtn}>
            ← Back
          </button>
        </div>

        <div style={admin.detailGroup}>
          <span style={admin.detailLabel}>Name</span>
          <span style={admin.detailValue}>{selectedWaiver.full_name}</span>
        </div>
        <div style={admin.detailGroup}>
          <span style={admin.detailLabel}>Email</span>
          <span style={admin.detailValue}>{selectedWaiver.email}</span>
        </div>
        <div style={admin.detailGroup}>
          <span style={admin.detailLabel}>Date</span>
          <span style={admin.detailValue}>{formatDate(selectedWaiver.created_at)}</span>
        </div>
        <div style={admin.detailGroup}>
          <span style={admin.detailLabel}>Minor</span>
          <span style={admin.detailValue}>
            {selectedWaiver.is_minor ? 'Yes — ' + (selectedWaiver.minor_name || 'N/A') : 'No'}
          </span>
        </div>
        {selectedWaiver.signature_url && (
          <div style={admin.detailGroup}>
            <span style={admin.detailLabel}>Signature</span>
            <img
              src={selectedWaiver.signature_url}
              alt="Signature"
              style={admin.signatureImg}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={admin.tabHeader}>
        <p style={admin.tabCount}>
          {waivers.length} total waiver{waivers.length !== 1 ? 's' : ''} on file
        </p>
        <button onClick={fetchWaivers} style={admin.refreshBtn}>↻ Refresh</button>
      </div>

      <div style={admin.toolbar}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or minor..."
          style={{ ...styles.input, marginBottom: 0, flex: 1 }}
        />
        <button onClick={exportCSV} style={admin.exportBtn}>
          Export CSV
        </button>
      </div>

      {loading && <p style={admin.statusText}>Loading waivers...</p>}
      {error && <p style={styles.error}>{error}</p>}

      {!loading && filtered.length === 0 && (
        <p style={admin.statusText}>
          {search ? 'No waivers match your search.' : 'No waivers found.'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div style={admin.tableWrap}>
          <table style={admin.table}>
            <thead>
              <tr>
                <th style={admin.th}>Date</th>
                <th style={admin.th}>Name</th>
                <th style={admin.th}>Email</th>
                <th style={admin.th}>Minor</th>
                <th style={admin.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} style={admin.tr}>
                  <td style={admin.td}>{new Date(w.created_at).toLocaleDateString()}</td>
                  <td style={admin.td}>{w.full_name}</td>
                  <td style={admin.td}>{w.email}</td>
                  <td style={admin.td}>
                    {w.is_minor ? (w.minor_name || 'Yes') : '—'}
                  </td>
                  <td style={admin.td}>
                    <button
                      onClick={() => setSelectedWaiver(w)}
                      style={admin.viewBtn}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ADMIN DASHBOARD — tabbed layout
// ============================================================

const TABS = [
  { id: 'waivers', label: 'Waivers (Legacy)' },
  { id: 'customers', label: 'Customers' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'waivers_v2', label: 'Waivers v2' },
  { id: 'games_played', label: 'Games Played' },
  { id: 'group_photos', label: 'Group Photos' },
  { id: 'webhook_events', label: 'Webhook Log' },
  { id: 'customer_update_log', label: 'Update Log' },
];

const TAB_CONFIGS = {
  customers: {
    tableName: 'customers',
    searchFields: ['full_name', 'email', 'phone'],
    columns: [
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'full_name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'date_of_birth', label: 'DOB' },
      { key: 'participant_type', label: 'Type' },
      { key: 'acquisition_source', label: 'Source' },
      { key: 'is_minor', label: 'Minor', type: 'bool' },
    ],
  },
  bookings: {
    tableName: 'bookeo_bookings',
    searchFields: ['bookeo_booking_id', 'room_name'],
    columns: [
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'bookeo_booking_id', label: 'Bookeo ID' },
      { key: 'room_name', label: 'Room' },
      { key: 'booked_for', label: 'Booked For', type: 'date' },
      { key: 'participant_count', label: 'Party' },
      { key: 'status', label: 'Status' },
    ],
  },
  waivers_v2: {
    tableName: 'waivers_v2',
    searchFields: [],
    columns: [
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'customer_id', label: 'Customer ID' },
      { key: 'booking_link_method', label: 'Link Method' },
      { key: 'booking_id', label: 'Booking ID' },
      { key: 'agreed_at', label: 'Agreed', type: 'date' },
    ],
  },
  games_played: {
    tableName: 'games_played',
    searchFields: ['room_name'],
    columns: [
      { key: 'played_at', label: 'Played', type: 'date' },
      { key: 'customer_id', label: 'Customer ID' },
      { key: 'room_name', label: 'Room' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'time_remaining', label: 'Time Left' },
      { key: 'source', label: 'Source' },
    ],
    orderBy: 'played_at',
  },
  group_photos: {
    tableName: 'group_photos',
    searchFields: ['caption'],
    columns: [
      { key: 'created_at', label: 'Uploaded', type: 'date' },
      { key: 'uploader_type', label: 'Uploader' },
      { key: 'booking_id', label: 'Booking ID' },
      { key: 'customer_id', label: 'Customer ID' },
      { key: 'caption', label: 'Caption' },
    ],
  },
  webhook_events: {
    tableName: 'webhook_events',
    searchFields: ['event_type', 'processing_status'],
    columns: [
      { key: 'created_at', label: 'Received', type: 'date' },
      { key: 'source', label: 'Source' },
      { key: 'event_type', label: 'Event' },
      { key: 'processing_status', label: 'Status' },
      { key: 'error_message', label: 'Error' },
      { key: 'payload', label: 'Payload', type: 'json' },
    ],
  },
  customer_update_log: {
    tableName: 'customer_update_log',
    searchFields: ['field_changed', 'changed_via'],
    columns: [
      { key: 'created_at', label: 'Changed', type: 'date' },
      { key: 'customer_id', label: 'Customer ID' },
      { key: 'field_changed', label: 'Field' },
      { key: 'old_value', label: 'Old' },
      { key: 'new_value', label: 'New' },
      { key: 'changed_via', label: 'Via' },
    ],
  },
};

function AdminDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('waivers_v2');

  const renderTab = () => {
    if (activeTab === 'waivers') return <WaiversTab />;
    const config = TAB_CONFIGS[activeTab];
    if (!config) return null;
    return (
      <GenericTableTab
        tableName={config.tableName}
        columns={config.columns}
        orderBy={config.orderBy || 'created_at'}
        orderAsc={false}
        searchFields={config.searchFields}
      />
    );
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: '1100px' }}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />
        <h1 style={styles.title}>Admin Dashboard</h1>

        <div style={admin.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...admin.tabBtn,
                ...(activeTab === tab.id ? admin.tabBtnActive : {}),
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={admin.tabContent}>
          {renderTab()}
        </div>

        <div style={admin.footerRow}>
          <button onClick={onLogout} style={admin.logoutBtn}>
            Log Out
          </button>
        </div>

        <p style={styles.footer}>
          REACT Premium Escape Rooms · Admin Dashboard
        </p>
      </div>
    </div>
  );
}

// ============================================================
// ADMIN LOGIN
// ============================================================
function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      onLogin();
    } else {
      setError('Incorrect password.');
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: '400px' }}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />
        <h1 style={styles.title}>Admin Login</h1>
        <p style={styles.subtitle}>Enter the admin password to continue.</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            style={styles.input}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.button}>
            Log In
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [page, setPage] = useState('waiver');
  const [adminAuth, setAdminAuth] = useState(false);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'admin') {
        setPage('admin');
      } else {
        setPage('waiver');
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  if (page === 'admin') {
    if (!adminAuth) {
      return <AdminLogin onLogin={() => setAdminAuth(true)} />;
    }
    return (
      <AdminDashboard
        onLogout={() => {
          setAdminAuth(false);
          window.location.hash = '';
        }}
      />
    );
  }

  return <WaiverForm />;
}

// ============================================================
// STYLES — Waiver Form
// ============================================================
const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '40px 16px',
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    background: '#111111',
    border: '1px solid #1a3a5c',
    borderRadius: '12px',
    padding: '36px 28px',
    boxShadow: '0 0 40px rgba(0, 100, 200, 0.08)',
  },
  logo: {
    display: 'block',
    margin: '0 auto 24px',
    maxWidth: '220px',
    height: 'auto',
  },
  title: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    textAlign: 'center',
    margin: '0 0 6px',
    letterSpacing: '0.5px',
  },
  subtitle: {
    color: '#7a8a9a',
    fontSize: '14px',
    textAlign: 'center',
    margin: '0 0 28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    color: '#c0d0e0',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
  },
  input: {
    background: '#0d1b2a',
    border: '1px solid #1a3a5c',
    borderRadius: '8px',
    padding: '12px 14px',
    color: '#e0e8f0',
    fontSize: '15px',
    marginBottom: '18px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  dobRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '18px',
  },
  dobSelect: {
    flex: 1,
    marginBottom: 0,
    cursor: 'pointer',
  },
  helperText: {
    color: '#5a7a9a',
    fontSize: '12px',
    marginTop: '-12px',
    marginBottom: '18px',
    lineHeight: '1.4',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '18px',
  },
  checkbox: {
    marginTop: '3px',
    accentColor: '#00bfff',
    width: '18px',
    height: '18px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  checkboxLabel: {
    color: '#b0c0d0',
    fontSize: '14px',
    lineHeight: '1.4',
    cursor: 'pointer',
  },
  waiverBox: {
    background: '#0a1520',
    border: '1px solid #1a2a3a',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '18px',
    maxHeight: '160px',
    overflowY: 'auto',
  },
  waiverText: {
    color: '#8090a0',
    fontSize: '13px',
    lineHeight: '1.6',
    margin: 0,
  },
  canvas: {
    width: '100%',
    height: '120px',
    background: '#0d1b2a',
    border: '1px solid #1a3a5c',
    borderRadius: '8px',
    cursor: 'crosshair',
    touchAction: 'none',
    marginBottom: '8px',
  },
  clearBtn: {
    alignSelf: 'flex-end',
    background: 'transparent',
    border: 'none',
    color: '#4a6a8a',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '4px 0',
    marginBottom: '20px',
    textDecoration: 'underline',
  },
  error: {
    color: '#ff4466',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '14px',
  },
  button: {
    background: 'linear-gradient(135deg, #0066cc, #00bfff)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '14px',
    fontSize: '16px',
    fontWeight: '700',
    cursor: 'pointer',
    letterSpacing: '0.5px',
    transition: 'opacity 0.2s',
  },
  successIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #0066cc, #00bfff)',
    color: '#fff',
    fontSize: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
    fontWeight: '700',
  },
  successTitle: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    textAlign: 'center',
    margin: '0 0 10px',
  },
  successText: {
    color: '#b0c0d0',
    fontSize: '15px',
    textAlign: 'center',
    margin: '0 0 6px',
    lineHeight: '1.5',
  },
  successSubtext: {
    color: '#5a7a9a',
    fontSize: '13px',
    textAlign: 'center',
    margin: '0 0 24px',
  },
  footer: {
    color: '#3a4a5a',
    fontSize: '11px',
    textAlign: 'center',
    marginTop: '28px',
    lineHeight: '1.4',
  },
};

// ============================================================
// STYLES — Admin Dashboard
// ============================================================
const admin = {
  tabBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '20px',
    borderBottom: '1px solid #1a2a3a',
    paddingBottom: '12px',
  },
  tabBtn: {
    background: 'transparent',
    color: '#5a7a9a',
    border: '1px solid transparent',
    borderRadius: '6px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  tabBtnActive: {
    background: '#0d1b2a',
    color: '#00bfff',
    border: '1px solid #1a3a5c',
  },
  tabContent: {
    minHeight: '200px',
  },
  tabHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  tabCount: {
    color: '#7a8a9a',
    fontSize: '13px',
    margin: 0,
  },
  toolbar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '16px',
    alignItems: 'center',
  },
  exportBtn: {
    background: '#1a3a5c',
    color: '#c0d0e0',
    border: '1px solid #2a4a6c',
    borderRadius: '8px',
    padding: '12px 18px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  refreshBtn: {
    background: 'transparent',
    border: 'none',
    color: '#4a8abf',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  footerRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #1a2a3a',
  },
  logoutBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6a4a4a',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  statusText: {
    color: '#5a7a9a',
    fontSize: '14px',
    textAlign: 'center',
    padding: '40px 0',
  },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: '8px',
    border: '1px solid #1a2a3a',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    color: '#7a8a9a',
    fontWeight: '600',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid #1a2a3a',
    background: '#0a1520',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #141e2a',
  },
  td: {
    padding: '10px 12px',
    color: '#b0c0d0',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  },
  nullCell: {
    color: '#3a4a5a',
  },
  jsonCell: {
    color: '#6a8aaf',
    fontFamily: 'monospace',
    fontSize: '11px',
  },
  viewBtn: {
    background: 'transparent',
    border: '1px solid #1a3a5c',
    color: '#4a9adf',
    borderRadius: '6px',
    padding: '4px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: '#4a9adf',
    fontSize: '14px',
    cursor: 'pointer',
  },
  detailGroup: {
    marginBottom: '18px',
  },
  detailLabel: {
    display: 'block',
    color: '#7a8a9a',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  detailValue: {
    color: '#e0e8f0',
    fontSize: '15px',
  },
  signatureImg: {
    maxWidth: '100%',
    height: 'auto',
    background: '#0d1b2a',
    border: '1px solid #1a3a5c',
    borderRadius: '8px',
    padding: '8px',
    marginTop: '4px',
  },
};

// redeploy trigger — phase 3
