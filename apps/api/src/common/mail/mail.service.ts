/**
 * Envoi des courriels transactionnels (réinitialisation de mot de passe).
 *
 * Render (offre gratuite) bloque les ports SMTP sortants : l'envoi passe donc
 * par l'API HTTPS de Brevo (https://api.brevo.com/v3/smtp/email), gratuite
 * jusqu'à 300 courriels par jour, sans nom de domaine — un expéditeur vérifié
 * (une adresse Gmail par exemple) suffit.
 *
 * Variables d'environnement :
 *  - `BREVO_API_KEY`     clé API Brevo (SMTP & API → API Keys) ;
 *  - `MAIL_FROM_EMAIL`   adresse d'expédition vérifiée dans Brevo ;
 *  - `MAIL_FROM_NAME`    nom affiché (défaut « RUNEX ») ;
 *  - `WEB_APP_URL`       adresse du site (défaut : première origine HTTPS de
 *                        `CORS_ORIGIN`, sinon http://localhost:3000).
 *
 * Sans configuration, aucun courriel ne part : en développement le lien est
 * écrit dans le journal, en production un avertissement l'est.
 */

export interface MailMessage {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export type MailResult = 'sent' | 'logged' | 'disabled' | 'failed';

const BREVO_URL = process.env.BREVO_API_URL?.trim() || 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10_000;

export function mailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim() && process.env.MAIL_FROM_EMAIL?.trim());
}

/** Adresse publique du site web, sans « / » final. */
export function webAppUrl(): string {
  const explicit = process.env.WEB_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const https = origins.find((o) => o.startsWith('https://'));
  return (https ?? origins[0] ?? 'http://localhost:3000').replace(/\/+$/, '');
}

let warned = false;

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[Mail] (non configuré) « ${message.subject} » → ${message.to.email}\n${message.text}`);
      return 'logged';
    }
    if (!warned) {
      warned = true;
      console.warn(
        '[Mail] BREVO_API_KEY / MAIL_FROM_EMAIL absents : les courriels (réinitialisation de mot de passe) ne sont pas envoyés.'
      );
    }
    return 'disabled';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY!.trim(),
      },
      body: JSON.stringify({
        sender: {
          email: process.env.MAIL_FROM_EMAIL!.trim(),
          name: process.env.MAIL_FROM_NAME?.trim() || 'RUNEX',
        },
        to: [{ email: message.to.email, ...(message.to.name ? { name: message.to.name } : {}) }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      console.error(`[Mail] Brevo a refusé l'envoi (${response.status}) : ${detail}`);
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    console.error('[Mail] Envoi impossible :', error instanceof Error ? error.message : error);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Courriel de réinitialisation, bilingue français / arabe. */
export function passwordResetEmail(params: { name: string; link: string; minutes: number; isDriver: boolean }): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(params.name || '');
  const link = escapeHtml(params.link);
  const driverFr = params.isDriver
    ? '<p style="margin:0 0 12px">Ensuite, reconnectez-vous dans l’application RUNEX Livreur avec le nouveau mot de passe.</p>'
    : '';
  const driverAr = params.isDriver
    ? '<p style="margin:0 0 12px">بعد ذلك، سجّل الدخول في تطبيق RUNEX للموزّع بكلمة المرور الجديدة.</p>'
    : '';
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
        <tr><td style="background:#E31E2B;padding:18px 24px;color:#fff;font-size:20px;font-weight:bold;letter-spacing:1px">RUNEX</td></tr>
        <tr><td style="padding:24px;font-size:15px;line-height:1.55">
          <p style="margin:0 0 12px">Bonjour ${name},</p>
          <p style="margin:0 0 12px">Une réinitialisation du mot de passe de votre compte RUNEX a été demandée. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Le lien est valable ${params.minutes} minutes et ne sert qu’une fois.</p>
          ${driverFr}
          <p style="margin:24px 0;text-align:center">
            <a href="${link}" style="display:inline-block;background:#E31E2B;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold">Choisir un nouveau mot de passe</a>
          </p>
          <p style="margin:0 0 20px;color:#6b7280;font-size:13px">Si vous n’êtes pas à l’origine de cette demande, ignorez ce courriel : votre mot de passe reste inchangé.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
          <div dir="rtl" style="text-align:right">
            <p style="margin:0 0 12px">مرحبًا ${name}،</p>
            <p style="margin:0 0 12px">طُلبت إعادة تعيين كلمة مرور حسابك في RUNEX. اضغط على الزر أعلاه لاختيار كلمة مرور جديدة. الرابط صالح لمدة ${params.minutes} دقيقة ولمرة واحدة فقط.</p>
            ${driverAr}
            <p style="margin:0;color:#6b7280;font-size:13px">إن لم تطلب ذلك، تجاهل هذه الرسالة: كلمة مرورك لن تتغيّر.</p>
          </div>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;word-break:break-all">${link}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = [
    `Bonjour ${params.name || ''},`,
    '',
    `Pour choisir un nouveau mot de passe RUNEX, ouvrez ce lien (valable ${params.minutes} minutes, une seule fois) :`,
    params.link,
    params.isDriver ? '\nEnsuite, reconnectez-vous dans l’application RUNEX Livreur.' : '',
    '',
    'Si vous n’êtes pas à l’origine de cette demande, ignorez ce courriel.',
    '',
    `لاختيار كلمة مرور جديدة، افتح الرابط أعلاه (صالح ${params.minutes} دقيقة، لمرة واحدة).`,
  ].join('\n');
  return { subject: 'RUNEX — Réinitialisation du mot de passe / إعادة تعيين كلمة المرور', html, text };
}
