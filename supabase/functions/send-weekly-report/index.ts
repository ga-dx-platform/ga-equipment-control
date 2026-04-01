import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Get active recipients
    const { data: recipients, error: recipientsError } = await sb
      .from('report_recipients')
      .select('name, email')
      .eq('is_active', true);

    if (recipientsError) throw recipientsError;
    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get weekly summary data
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: borrows } = await sb
      .from('borrow_records')
      .select('*')
      .gte('borrowed_at', weekAgo);

    const totalBorrowed = borrows?.length ?? 0;
    const returned = borrows?.filter(r => r.status === 'returned').length ?? 0;
    const overdue = borrows?.filter(r => r.status === 'overdue').length ?? 0;

    // Send email to each recipient via Resend (or your email provider)
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    let sent = 0;

    for (const recipient of recipients) {
      const body = {
        from: 'GA Equipment <noreply@yourdomain.com>',
        to: [recipient.email],
        subject: `รายงานประจำสัปดาห์ — GA Equipment Control`,
        html: `
          <h2>สรุปการยืม-คืนอุปกรณ์รายสัปดาห์</h2>
          <p>เรียน คุณ${recipient.name}</p>
          <ul>
            <li>ยืมทั้งหมด: <strong>${totalBorrowed} รายการ</strong></li>
            <li>คืนแล้ว: <strong>${returned} รายการ</strong></li>
            <li>เกินกำหนด: <strong>${overdue} รายการ</strong></li>
          </ul>
        `,
      };

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) sent++;
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
