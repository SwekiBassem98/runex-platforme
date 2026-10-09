/**
 * Textes rédigés par l'API, en français, traduits pour l'affichage.
 *
 * La chronologie d'un colis, son journal d'audit, les motifs de retour ou de
 * livraison partielle et les titres de notification sont écrits en base, en
 * français, au moment de l'événement. Le portail expéditeur en arabe les
 * affichait tels quels : un écran arabe semé de phrases françaises.
 *
 * Ce module reconnaît ces phrases — elles sont produites par un nombre fini de
 * gabarits côté API — et en donne la version arabe. Ce qui n'est pas reconnu
 * (texte libre saisi par un utilisateur : « test 1 », un nom, une adresse)
 * reste tel quel : on ne traduit pas ce que quelqu'un a écrit.
 *
 * Les gabarits sont ceux de :
 *  - apps/api/src/modules/colis/colis.service.ts (titres, descriptions) ;
 *  - apps/api/src/modules/colis/package-workflow.service.ts (« Livré : … —
 *    Repris : … — Encaissé : … », phrases d'audit « Colis #… : A → B ») ;
 *  - apps/api/src/modules/runsheets, depot, inter-depots, ramassages, payments ;
 *  - l'application livreur (motifs et descriptions de livraison partielle) ;
 *  - le formulaire de retour du back-office.
 * Un gabarit ajouté côté API sans entrée ici s'affiche en français : c'est le
 * repli voulu, jamais un texte vide.
 */

import { AUDIT_ACTIONS, PACKAGE_STATUS_LABELS, type PackageStatus } from '@logixpress/types';
import type { Langue } from './config';

/** Phrases fixes : titres d'événements, motifs proposés, descriptions sans variable. */
const PHRASES_AR: Readonly<Record<string, string>> = {
  // Chronologie et notifications
  "Colis créé par l'expéditeur": 'أنشأ المرسل الطرد',
  'Colis accepté au dépôt': 'تم قبول الطرد بالمستودع',
  'Colis intégré à une tournée': 'أُدرج الطرد في جولة',
  'Livraison démarrée': 'انطلق التوصيل',
  'Départ en tournée': 'انطلاق الجولة',
  'Colis livré et paiement encaissé': 'تم توصيل الطرد وتحصيل المبلغ',
  'Livraison partielle': 'توصيل جزئي',
  'Échange marchandise': 'استبدال البضاعة',
  'Livraison reportée': 'تأجيل التوصيل',
  'Colis retourné au dépôt': 'أُرجع الطرد إلى المستودع',
  "Colis restitué à l'expéditeur": 'أُعيد الطرد إلى المرسل',
  "Modification par l'expéditeur": 'تعديل من المرسل',
  'Montant modifié sur un colis': 'تعديل مبلغ طرد',
  'Nombre de pièces modifié': 'تعديل عدد القطع',
  'Colis modifié': 'تعديل الطرد',
  'Colis annulé': 'إلغاء الطرد',
  'Statut de livraison modifié': 'تغيّر وضع التوصيل',
  'Nouveau colis à traiter': 'طرد جديد للمعالجة',
  'Nouvelle livraison à effectuer': 'توصيل جديد',
  'Nouvelle demande de ramassage': 'طلب استلام جديد',
  'Créneau de ramassage confirmé': 'تأكيد موعد الاستلام',
  'Ramassage à collecter': 'استلام مبرمج',
  'Ramassage effectué': 'تم الاستلام',
  'Ramassage annulé': 'أُلغي الاستلام',
  'Encaissement à valider': 'تحصيل في انتظار المصادقة',
  'Encaissement validé': 'تمت المصادقة على التحصيل',
  // Descriptions sans variable
  'Affecté sans tournée': 'مُسند دون جولة',
  "Le livreur est en cours d'acheminement": 'السائق في الطريق',
  'Restitution définitive effectuée': 'تمت الإعادة النهائية',
  // Motifs proposés (application livreur, back-office)
  'Articles partiels acceptés': 'قبول جزئي للمنتجات',
  "Annulation par l'expéditeur": 'إلغاء من المرسل',
  'Refus de commande par le destinataire': 'رفض الطلب من المستلم',
  'Colis non conforme aux attentes client': 'الطرد غير مطابق لتوقعات العميل',
  'Destinataire introuvable après 3 passages': 'تعذّر العثور على المستلم بعد 3 محاولات',
  'Client injoignable après relances': 'تعذّر الاتصال بالعميل رغم التذكير',
  'Client injoignable': 'تعذّر الاتصال بالعميل',
  'Colis refusé - Produit non conforme': 'رُفض الطرد - منتج غير مطابق',
  'Client a annulé la commande': 'ألغى العميل الطلب',
  'Adresse erronée ou introuvable': 'عنوان خاطئ أو غير موجود',
  'Client absent': 'العميل غائب',
  'Reporté à demain 14h': 'مؤجّل إلى الغد على الساعة 14:00',
  'Client demande report fin de semaine': 'العميل يطلب التأجيل إلى نهاية الأسبوع',
  // Moyens de paiement cités dans les phrases
  'Espèces': 'نقدًا',
  'Chèque': 'صك',
  'Virement': 'تحويل بنكي',
  'Carte bancaire': 'بطاقة بنكية',
  'Paiement mobile': 'دفع عبر الهاتف',
};

/** Libellés d'audit par code d'action (stables, contrairement aux libellés). */
const ACTIONS_AUDIT_AR: Readonly<Record<string, string>> = {
  COLIS_CREE: 'إنشاء الطرد',
  COLIS_MODIFIE: 'تعديل الطرد',
  UPDATE_CRITICAL_FIELDS: 'تعديل المبلغ أو معلومة أساسية',
  CANCEL: 'إلغاء الطرد',
  SOFT_DELETE: 'حذف الطرد',
  ASSIGN_DRIVER: 'إسناد الطرد إلى سائق',
  PACKAGE_RECEIVED_AT_DEPOT: 'استلام الطرد بالمستودع',
  COLIS_RAMASSE: 'تم استلام الطرد من المرسل',
  DELIVERY_STARTED: 'انطلق التوصيل',
  DELIVERY_DONE: 'تمت المصادقة على التوصيل',
  DELIVERY_PARTIAL: 'تمت المصادقة على التوصيل الجزئي',
  DELIVERY_POSTPONED: 'تأجيل التوصيل',
  DELIVERY_FAILED: 'فشل التوصيل',
  PACKAGE_EXCHANGE: 'استبدال الطرد بآخر',
  PACKAGE_RETURNED: 'إرجاع الطرد إلى المستودع',
  RESTORED_TO_SHIPPER: 'إعادة الطرد إلى المرسل',
  RUNSHEET_CREE: 'إنشاء جولة',
  PACKAGE_ADDED: 'إدراج الطرد في الجولة',
  PACKAGE_REMOVED: 'سحب الطرد من الجولة',
  RUNSHEET_PACKAGE_ADDED: 'إدراج الطرد في جولة',
  RUNSHEET_DEPARTURE: 'انطلاق الجولة',
  RUNSHEET_DEPART: 'انطلاق الجولة',
  RUNSHEET_CLOSED: 'إغلاق الجولة',
  RUNSHEET_ANNULEE: 'إلغاء الجولة',
  RUNSHEET_STATUT: 'تغيير وضع الجولة',
  CASH_PAYMENT_VALIDATED: 'المصادقة على التحصيل',
  CASH_PAYMENT_REJECTED: 'رفض التحصيل',
  PAYMENT_VALIDATED: 'المصادقة على الدفع',
  PAYMENT_VOUCHER_PAID: 'صرف الكشف',
  PAYMENT_REFUNDED: 'استرجاع الدفع',
  RAMASSAGE_COLIS: 'إلحاق الطرد بالاستلام',
  INTERDEPOT_CHARGEMENT: 'تحميل الطرد في النقل بين المستودعات',
  INTERDEPOT_ACCEPTATION: 'قبول الطرد عند الوصول',
  INTERDEPOT_RETRAIT: 'سحب الطرد من النقل بين المستودعات',
  INTERDEPOT_ANNULATION: 'إلغاء النقل بين المستودعات',
  TRANSFERT_RECU: 'استلام النقل بين المستودعات',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
};

const STATUT_PAR_LIBELLE: ReadonlyMap<string, PackageStatus> = new Map(
  (Object.entries(PACKAGE_STATUS_LABELS) as [PackageStatus, string][]).map(([code, libelle]) => [libelle, code])
);

/** Traduction d'un libellé de statut français (« Affecté à une tournée »). */
type TraduireStatut = (code: PackageStatus) => string;

type Modele = [RegExp, (m: RegExpMatchArray, segment: (s: string) => string) => string];

/** Gabarits d'un segment (une phrase sans « — »). */
const MODELES_AR: readonly Modele[] = [
  [/^Livraison partielle : (\d+)\/(\d+) pièces$/, (m) => `توصيل جزئي: ${m[1]}/${m[2]} قطع`],
  [/^Intégré à la tournée (\S+)$/, (m) => `أُدرج في الجولة ${m[1]}`],
  [/^Colis affecté à (.+)$/, (m) => `أُسند الطرد إلى ${m[1]}`],
  [/^Colis réaffecté à (.+)$/, (m) => `أُعيد إسناد الطرد إلى ${m[1]}`],
  [/^Retiré de l'inter-dépôt (\S+)$/, (m) => `سُحب من النقل بين المستودعات ${m[1]}`],
  [/^Inter-dépôt (\S+) reçu$/, (m) => `تم استلام النقل بين المستودعات ${m[1]}`],
  [/^Inter-dépôt (\S+) annulé$/, (m) => `أُلغي النقل بين المستودعات ${m[1]}`],
  [/^Inter-dépôt (\S+)$/, (m) => `النقل بين المستودعات ${m[1]}`],
  [/^Tournée (\S+)$/, (m) => `الجولة ${m[1]}`],
  [/^Colis enregistré par (.+)$/, (m) => `سجّله ${m[1]}`],
  [/^Retiré par (.+)$/, (m) => `سحبه ${m[1]}`],
  [/^Champs modifiés : (.+)$/, (m) => `الحقول المعدّلة: ${m[1]}`],
  [/^Scan « (.+) » reçu à (.+)$/, (m) => `مسح « ${m[1]} » واستلام في ${m[2]}`],
  [/^Colis remis en stock à (.+)$/, (m) => `أُعيد الطرد إلى المخزون في ${m[1]}`],
  [/^(\d+) pièce\(s\) acceptée\(s\)$/, (m) => `${m[1]} قطعة مقبولة`],
  [/^(\d+) colis chargé\(s\)$/, (m) => `${m[1]} طرد محمّل`],
  [/^(\d+)\/(\d+) colis reçus$/, (m) => `${m[1]}/${m[2]} طرد مستلم`],
  [/^(\d+) pièce\(s\) remise\(s\) sur (\d+)$/, (m) => `${m[1]} قطعة مسلّمة من ${m[2]}`],
  [/^(\d+) pièce\(s\) ramenée\(s\) au dépôt$/, (m) => `${m[1]} قطعة أُعيدت إلى المستودع`],
  [/^Livré : (.+)$/, (m, seg) => `تم التسليم: ${seg(m[1])}`],
  [/^Repris : (.+)$/, (m, seg) => `مُرجَع: ${seg(m[1])}`],
  [/^Encaissé : (.+)$/, (m) => `تم التحصيل: ${m[1]}`],
  [/^Non encaissé : (.+)$/, (m) => `غير محصّل: ${m[1]}`],
  [/^motif : (.+)$/, (m, seg) => `السبب: ${seg(m[1])}`],
];

/**
 * Corps de notification : phrases entières, avec numéros, montants et noms
 * repris tels quels. `statut` traduit un libellé de statut français.
 */
const PHRASES_ENTIERES_AR: readonly [
  RegExp,
  (m: RegExpMatchArray, statut: (libelle: string) => string, segments: (s: string) => string) => string,
][] = [
  [/^(.+) a porté le colis #(\S+) au statut « (.+) »\.$/, (m, st) => `نقل ${m[1]} الطرد #${m[2]} إلى الوضع « ${st(m[3]!)} ».`],
  [/^Le colis #(\S+) de (.+) attend d'être pris en charge\.$/, (m) => `الطرد #${m[1]} الخاص بـ ${m[2]} في انتظار التكفّل.`],
  [/^(.+) a porté le montant dû du colis #(\S+) de (\S+) DT à (\S+) DT\.\s*(.*)$/, (m, _st, seg) => `غيّر ${m[1]} المبلغ المستحق للطرد #${m[2]} من ${m[3]} DT إلى ${m[4]} DT.${m[5] ? ` ${seg(m[5])}` : ''}`],
  [/^(.+) a porté le nombre de pièces du colis #(\S+) de (\d+) à (\d+)\.$/, (m) => `غيّر ${m[1]} عدد قطع الطرد #${m[2]} من ${m[3]} إلى ${m[4]}.`],
  [/^(.+) a modifié (.+) du colis #(\S+)\.$/, (m) => `عدّل ${m[1]} بيانات الطرد #${m[3]} (${m[2]}).`],
  [/^Le colis #(\S+) a été livré à (\d+)\/(\d+) pièces, pour (\S+) DT encaissés sur (\S+) DT\. (\d+) pièce\(s\) repart(?:ent)? avec le livreur\.$/, (m) => `سُلّم الطرد #${m[1]} جزئيًا (${m[2]}/${m[3]} قطع)، وتم تحصيل ${m[4]} DT من ${m[5]} DT. ${m[6]} قطعة تعود مع السائق.`],
  [/^La livraison du colis #(\S+) est reportée(?: au (.+?))?\. Motif : (.+)$/, (m, _st, seg) => `تأجّل توصيل الطرد #${m[1]}${m[2] ? ` إلى ${m[2]}` : ''}. السبب: ${seg(m[3]!)}`],
  [/^(.+) a restitué le colis #(\S+) à son expéditeur\.$/, (m) => `أعاد ${m[1]} الطرد #${m[2]} إلى المرسل.`],
  [/^(\S+) DT ont été encaissés à la livraison \(attendu : (\S+) DT, moyen : (.+?)\)\. L'encaissement (\S+) attend la caisse\.$/, (m, _st, seg) => `تم تحصيل ${m[1]} DT عند التوصيل (المنتظر: ${m[2]} DT، الطريقة: ${seg(m[3]!)}). التحصيل ${m[4]} في انتظار الصندوق.`],
  [/^(.+) a validé l'encaissement (\S+) de (\S+) DT\.$/, (m) => `صادق ${m[1]} على التحصيل ${m[2]} بقيمة ${m[3]} DT.`],
  [/^Votre collecte du (.+) est confirmée\.$/, (m) => `تم تأكيد استلام طرودك يوم ${m[1]}.`],
  [/^Collecte du (.+) terminée\.\s*(.*)$/, (m) => `انتهى الاستلام يوم ${m[1]}.${m[2] ? ` ${m[2]}` : ''}`],
  [/^Le ramassage (\S+) du (.+) est annulé\.$/, (m) => `أُلغي الاستلام ${m[1]} المبرمج يوم ${m[2]}.`],
  [/^Le ramassage (\S+) \((.+)\) vous est affecté\.$/, (m) => `أُسند إليك الاستلام ${m[1]} (${m[2]}).`],
  [/^Le colis #(\S+) a rejoint la tournée (\S+) de (.+)\.$/, (m) => `انضم الطرد #${m[1]} إلى جولة ${m[3]} ${m[2]}.`],
];

function traduireSegmentAr(segment: string): string {
  const s = segment.trim();
  if (!s) return segment;
  const fixe = PHRASES_AR[s] ?? PHRASES_AR[s.replace(/\.$/, '')];
  if (fixe) return fixe;
  for (const [motif, rendu] of MODELES_AR) {
    const m = s.match(motif);
    if (m) return rendu(m, traduireSegmentAr);
  }
  return segment;
}

/**
 * Traduit un texte produit par l'API. En français (ou langue inconnue), le
 * texte est rendu tel quel.
 */
export function traduireTexteServeur(
  texte: string | null | undefined,
  langue: Langue,
  traduireStatut: TraduireStatut
): string {
  if (!texte) return texte ?? '';
  if (langue !== 'ar') return texte;
  const s = texte.trim();

  const statut = (libelle: string) => {
    const code = STATUT_PAR_LIBELLE.get(libelle.trim());
    return code ? traduireStatut(code) : traduireSegmentAr(libelle);
  };

  // Phrase d'audit d'un changement de statut :
  // « Colis #X : A → B — motif : M (par N). »
  const transition = s.match(/^Colis #(\S+) : (.+?) → (.+?)(?: — motif : (.+))? \(par (.+)\)\.?$/);
  if (transition) {
    const [, numero, de, vers, motif, auteur] = transition;
    return (
      `الطرد #${numero}: ${statut(de!)} ← ${statut(vers!)}` +
      (motif ? ` — السبب: ${traduireSegments(motif)}` : '') +
      ` (بواسطة ${auteur})`
    );
  }
  // Phrase d'audit d'un acte sans changement de statut :
  // « Colis #X : <titre> — motif : M (par N). »
  const acte = s.match(/^Colis #(\S+) : (.+?)(?: — motif : (.+))? \(par (.+)\)\.?$/);
  if (acte) {
    const [, numero, titre, motif, auteur] = acte;
    return (
      `الطرد #${numero}: ${traduireSegmentAr(titre!)}` +
      (motif ? ` — السبب: ${traduireSegments(motif)}` : '') +
      ` (بواسطة ${auteur})`
    );
  }
  for (const [motif, rendu] of PHRASES_ENTIERES_AR) {
    const m = s.match(motif);
    if (m) return rendu(m, statut, traduireSegments);
  }

  const tournee = s.match(/^Colis #(\S+) (ajouté à|retiré de) la tournée (\S+?)\.?$/);
  if (tournee) {
    const [, numero, sens, n] = tournee;
    return sens === 'ajouté à'
      ? `أُدرج الطرد #${numero} في الجولة ${n}`
      : `سُحب الطرد #${numero} من الجولة ${n}`;
  }

  return traduireSegments(s);
}

/** « A — B — C » : chaque partie est traduite séparément. */
function traduireSegments(texte: string): string {
  return texte
    .split(' — ')
    .map((partie) => traduireSegmentAr(partie))
    .join(' — ');
}

/**
 * Libellé d'une action d'audit, à partir de son code (plus fiable que le
 * libellé français déjà calculé par l'API).
 */
export function libelleActionAudit(
  code: string,
  libelleServeur: string | undefined,
  langue: Langue,
  traduireStatut: TraduireStatut
): string {
  if (langue !== 'ar') return libelleServeur ?? AUDIT_ACTIONS[code]?.label ?? code;
  const direct = ACTIONS_AUDIT_AR[code];
  if (direct) return direct;
  const statut = code.match(/^PACKAGE_STATUS_(.+)$/);
  if (statut && statut[1]! in PACKAGE_STATUS_LABELS) {
    return `وضع الطرد: ${traduireStatut(statut[1] as PackageStatus)}`;
  }
  return traduireTexteServeur(libelleServeur ?? code, langue, traduireStatut);
}
