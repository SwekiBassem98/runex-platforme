/**
 * Libellés du design system.
 *
 * Le design system ne connaît pas les langues : il sait qu'un composant doit
 * dire « Page précédente » ou « Réinitialiser », et il demande quelle langue
 * employer. Les chaînes sont donc une donnée, versionnée par langue, fournie par
 * `LibellesUIProvider`.
 *
 * Le français reste la valeur par défaut : sans provider — ce qui est le cas des
 * pages d'exploitation tant qu'elles ne sont pas traduites — les composants
 * s'affichent exactement comme avant.
 */

export interface LibellesUI {
  'pagination.libelle': string;
  'pagination.resume': string;
  'pagination.aucun': string;
  'pagination.page': string;
  'pagination.parPage': string;
  'pagination.nombreParPage': string;
  'pagination.precedente': string;
  'pagination.suivante': string;
  'filtres.reinitialiser': string;
  'filtres.actifs': string;
  'filtres.titre': string;
  'filtres.actifsBadge': string;
  'filtres.retirer': string;
  'filtres.rechercher': string;
  'form.obligatoire': string;
  'erreur.reessayer': string;
  'erreur.masquer': string;
'table.fiches': string;
'table.libelle': string;
  'table.defilement': string;
  'recherche.effacer': string;
  'toast.fermer': string;
  'panneau.fermer': string;
  'fenetre.fermer': string;
  'delai.moment': string;
  'delai.minutes': string;
  'delai.heures': string;
  'delai.jours': string;
  'delai.mois': string;
  'delai.annee': string;
  'delai.annees': string;
  'menu.navigation': string;
  'menu.ouvrir': string;
  'menu.fermer': string;
  'menu.deplier': string;
  'menu.replier': string;
  'menu.deconnecter': string;
}

export const LIBELLES_FR: LibellesUI = {
  'pagination.libelle': 'Pagination',
  'pagination.resume': '{debut} à {fin} sur {total} {libelle}',
  'pagination.aucun': 'Aucun {libelle}',
  'pagination.page': 'Page',
  'pagination.parPage': '{n} par page',
  'pagination.nombreParPage': 'Nombre de {libelle} par page',
  'pagination.precedente': 'Page précédente',
  'pagination.suivante': 'Page suivante',
  'filtres.reinitialiser': 'Réinitialiser',
  'filtres.actifs': '{n} actif(s)',
  'filtres.titre': 'Filtres',
  'filtres.actifsBadge': 'actifs',
  'filtres.retirer': 'Retirer le filtre {libelle}',
  'filtres.rechercher': 'Rechercher',
  'form.obligatoire': '(obligatoire)',
  'erreur.reessayer': 'Réessayer',
  'erreur.masquer': 'Masquer le message',
  'table.fiches': 'Fiches',
  'table.libelle': 'Tableau',
  'table.defilement': 'Tableau — défilement horizontal',
  'recherche.effacer': 'Effacer la recherche',
  'toast.fermer': 'Fermer la notification',
  'panneau.fermer': 'Fermer le panneau',
  'fenetre.fermer': 'Fermer la fenêtre',
  'delai.moment': "à l'instant",
  'delai.minutes': 'il y a {n} min',
  'delai.heures': 'il y a {n} h',
  'delai.jours': 'il y a {n} j',
  'delai.mois': 'il y a {n} mois',
  'delai.annee': 'il y a {n} an',
  'delai.annees': 'il y a {n} ans',
  'menu.navigation': 'Navigation principale',
  'menu.ouvrir': 'Ouvrir le menu',
  'menu.fermer': 'Fermer le menu',
  'menu.deplier': 'Déplier le menu',
  'menu.replier': 'Replier le menu',
  'menu.deconnecter': 'Se déconnecter',
};

export const LIBELLES_AR: LibellesUI = {
  'pagination.libelle': 'ترقيم الصفحات',
  'pagination.resume': '{debut} إلى {fin} من أصل {total} {libelle}',
  'pagination.aucun': 'لا يوجد {libelle}',
  'pagination.page': 'صفحة',
  'pagination.parPage': '{n} في الصفحة',
  'pagination.nombreParPage': 'عدد {libelle} في الصفحة',
  'pagination.precedente': 'الصفحة السابقة',
  'pagination.suivante': 'الصفحة التالية',
  'filtres.reinitialiser': 'إعادة تعيين',
  'filtres.actifs': '{n} مفعّل',
  'filtres.titre': 'عوامل التصفية',
  'filtres.actifsBadge': 'مفعّلة',
  'filtres.retirer': 'إزالة عامل التصفية {libelle}',
  'filtres.rechercher': 'بحث',
  'form.obligatoire': '(إجباري)',
  'erreur.reessayer': 'إعادة المحاولة',
  'erreur.masquer': 'إخفاء الرسالة',
  'table.fiches': 'بطاقات',
  'table.libelle': 'جدول',
  'table.defilement': 'جدول — تمرير أفقي',
  'recherche.effacer': 'مسح البحث',
  'toast.fermer': 'إغلاق الإشعار',
  'panneau.fermer': 'إغلاق اللوحة',
  'fenetre.fermer': 'إغلاق النافذة',
  'delai.moment': 'الآن',
  'delai.minutes': 'قبل {n} دقيقة',
  'delai.heures': 'قبل {n} ساعة',
  'delai.jours': 'قبل {n} يوم',
  'delai.mois': 'قبل {n} شهر',
  'delai.annee': 'قبل سنة',
  'delai.annees': 'قبل {n} سنوات',
  'menu.navigation': 'التنقّل الرئيسي',
  'menu.ouvrir': 'فتح القائمة',
  'menu.fermer': 'إغلاق القائمة',
  'menu.deplier': 'توسيع القائمة',
  'menu.replier': 'طيّ القائمة',
  'menu.deconnecter': 'تسجيل الخروج',
};