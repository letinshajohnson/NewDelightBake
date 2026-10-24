import { createContext, useContext, useEffect, useState } from "react";

export const LANGS = [
  { code: "en", name: "English" }, { code: "id", name: "Bahasa Indonesia" }, { code: "ar", name: "العربية", rtl: true },
  { code: "nl", name: "Nederlands" }, { code: "hi", name: "हिन्दी" }, { code: "es", name: "Español" }, { code: "fr", name: "Français" },
];
const IDX = { en: 0, id: 1, ar: 2, nl: 3, hi: 4, es: 5, fr: 6 };

// key: [en, id, ar, nl, hi, es, fr]
const D = {
  dashboard: ["Dashboard", "Dasbor", "لوحة التحكم", "Dashboard", "डैशबोर्ड", "Panel", "Tableau de bord"],
  products: ["Products", "Produk", "المنتجات", "Producten", "उत्पाद", "Productos", "Produits"],
  inventory: ["Inventory", "Inventaris", "المخزون", "Voorraad", "इन्वेंटरी", "Inventario", "Stock"],
  promotions: ["Promotions", "Promosi", "العروض", "Promoties", "प्रमोशन", "Promociones", "Promotions"],
  customers: ["Customers", "Pelanggan", "العملاء", "Klanten", "ग्राहक", "Clientes", "Clients"],
  sales: ["Sales", "Penjualan", "المبيعات", "Verkopen", "बिक्री", "Ventas", "Ventes"],
  shifts: ["Shifts & cash", "Shift & kas", "الورديات والنقد", "Diensten & kas", "शिफ्ट और नकद", "Turnos y caja", "Services & caisse"],
  reports: ["Reports", "Laporan", "التقارير", "Rapporten", "रिपोर्ट", "Informes", "Rapports"],
  settings: ["Settings", "Pengaturan", "الإعدادات", "Instellingen", "सेटिंग्स", "Ajustes", "Paramètres"],
  cashier: ["Open till", "Buka kasir", "فتح الكاشير", "Kassa openen", "कैश काउंटर", "Abrir caja", "Ouvrir la caisse"],
  kitchen: ["Kitchen display", "Layar dapur", "شاشة المطبخ", "Keukenscherm", "किचन डिस्प्ले", "Pantalla de cocina", "Écran cuisine"],
  logout: ["Sign out", "Keluar", "تسجيل الخروج", "Uitloggen", "साइन आउट", "Cerrar sesión", "Se déconnecter"],
  search: ["Search or scan barcode", "Cari atau pindai barcode", "ابحث أو امسح الباركود", "Zoek of scan barcode", "खोजें या बारकोड स्कैन करें", "Buscar o escanear", "Rechercher ou scanner"],
  all: ["All", "Semua", "الكل", "Alles", "सभी", "Todo", "Tout"],
  cart: ["Current sale", "Penjualan", "البيع الحالي", "Huidige verkoop", "वर्तमान बिक्री", "Venta actual", "Vente en cours"],
  empty_cart: ["Tap a product or scan a barcode", "Ketuk produk atau pindai", "اضغط على منتج أو امسح الباركود", "Tik een product of scan", "उत्पाद चुनें या स्कैन करें", "Toca un producto o escanea", "Touchez un produit ou scannez"],
  subtotal: ["Subtotal", "Subtotal", "المجموع الفرعي", "Subtotaal", "उप-योग", "Subtotal", "Sous-total"],
  discount: ["Discount", "Diskon", "الخصم", "Korting", "छूट", "Descuento", "Remise"],
  tax: ["Tax", "Pajak", "الضريبة", "Btw", "कर", "Impuesto", "Taxe"],
  service: ["Service charge", "Biaya layanan", "رسوم الخدمة", "Servicekosten", "सेवा शुल्क", "Cargo por servicio", "Frais de service"],
  rounding: ["Rounding", "Pembulatan", "التقريب", "Afronding", "राउंडिंग", "Redondeo", "Arrondi"],
  total: ["Total", "Total", "الإجمالي", "Totaal", "कुल", "Total", "Total"],
  pay: ["Pay", "Bayar", "ادفع", "Betalen", "भुगतान", "Cobrar", "Payer"],
  hold: ["Hold", "Tahan", "تعليق", "Parkeren", "होल्ड", "Aparcar", "Mettre en attente"],
  held: ["Held orders", "Pesanan ditahan", "الطلبات المعلقة", "Geparkeerd", "होल्ड ऑर्डर", "Aparcados", "En attente"],
  clear: ["Clear", "Hapus", "مسح", "Wissen", "साफ़", "Vaciar", "Vider"],
  customer: ["Customer", "Pelanggan", "العميل", "Klant", "ग्राहक", "Cliente", "Client"],
  walk_in: ["Walk-in customer", "Pelanggan umum", "عميل عابر", "Losse klant", "वॉक-इन ग्राहक", "Cliente ocasional", "Client de passage"],
  voucher: ["Voucher", "Voucher", "قسيمة", "Voucher", "वाउचर", "Cupón", "Bon"],
  points: ["Points", "Poin", "النقاط", "Punten", "पॉइंट्स", "Puntos", "Points"],
  offline: ["Offline", "Luring", "غير متصل", "Offline", "ऑफ़लाइन", "Sin conexión", "Hors ligne"],
  online: ["Online", "Daring", "متصل", "Online", "ऑनलाइन", "En línea", "En ligne"],
  pending_sync: ["pending sync", "menunggu sinkron", "بانتظار المزامنة", "wacht op sync", "सिंक बाकी", "pendientes", "en attente"],
  sync_now: ["Sync now", "Sinkron", "زامن الآن", "Nu syncen", "अभी सिंक करें", "Sincronizar", "Synchroniser"],
  open_shift: ["Open register", "Buka shift", "فتح الوردية", "Kassa openen", "शिफ्ट शुरू", "Abrir turno", "Ouvrir la caisse"],
  close_shift: ["Close register", "Tutup shift", "إغلاق الوردية", "Kassa sluiten", "शिफ्ट बंद", "Cerrar turno", "Fermer la caisse"],
  tables: ["Tables", "Meja", "الطاولات", "Tafels", "टेबल", "Mesas", "Tables"],
  retail: ["Counter", "Kasir", "الكاونتر", "Toonbank", "काउंटर", "Mostrador", "Comptoir"],
  send_kitchen: ["Send to kitchen", "Kirim ke dapur", "أرسل للمطبخ", "Naar keuken", "किचन भेजें", "Enviar a cocina", "Envoyer en cuisine"],
  new: ["New", "Baru", "جديد", "Nieuw", "नया", "Nuevo", "Nouveau"],
  preparing: ["Preparing", "Disiapkan", "قيد التحضير", "In bereiding", "तैयार हो रहा", "Preparando", "En préparation"],
  ready: ["Ready", "Siap", "جاهز", "Klaar", "तैयार", "Listo", "Prêt"],
  change: ["Change", "Kembalian", "الباقي", "Wisselgeld", "बाकी पैसे", "Cambio", "Monnaie"],
  remaining: ["Remaining", "Sisa", "المتبقي", "Resterend", "शेष", "Pendiente", "Restant"],
  complete: ["Complete sale", "Selesaikan", "إتمام البيع", "Verkoop afronden", "बिक्री पूरी करें", "Completar venta", "Valider la vente"],
  print: ["Print receipt", "Cetak struk", "طباعة الإيصال", "Bon printen", "रसीद प्रिंट", "Imprimir ticket", "Imprimer le ticket"],
  new_sale: ["New sale", "Penjualan baru", "بيع جديد", "Nieuwe verkoop", "नई बिक्री", "Nueva venta", "Nouvelle vente"],
  sign_in: ["Sign in", "Masuk", "تسجيل الدخول", "Inloggen", "साइन इन", "Iniciar sesión", "Se connecter"],
  email: ["Email", "Email", "البريد الإلكتروني", "E-mail", "ईमेल", "Correo", "E-mail"],
  password: ["Password", "Kata sandi", "كلمة المرور", "Wachtwoord", "पासवर्ड", "Contraseña", "Mot de passe"],
  switch_user: ["Switch cashier", "Ganti kasir", "تبديل الكاشير", "Wissel kassier", "कैशियर बदलें", "Cambiar cajero", "Changer de caissier"],
  panel: ["Back office", "Kantor", "المكتب الخلفي", "Backoffice", "बैक ऑफिस", "Back office", "Back-office"],
};

const I18nCtx = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(localStorage.getItem("poshub.lang") || "en");
  const rtl = !!LANGS.find((l) => l.code === lang)?.rtl;
  useEffect(() => {
    localStorage.setItem("poshub.lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [lang, rtl]);
  const t = (k) => (D[k] ? D[k][IDX[lang]] || D[k][0] : k);
  return <I18nCtx.Provider value={{ lang, setLang, t, rtl }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
