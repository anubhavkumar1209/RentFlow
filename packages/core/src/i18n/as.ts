// Draft translation: needs review by a native Assamese speaker before launch.
// WhatsApp doesn't offer Assamese for business messages (Meta's template languages), so the
// WhatsApp side is Hindi; the pay page and the app are in Assamese.
import { hi } from "./hi";
import type { LanguagePack } from "./types";

export const as: LanguagePack = {
  ...hi,
  payPage: {
    hi: (n) => `নমস্কাৰ ${n}`,
    bill: (period, room) => `${period}ৰ বিল · ৰুম ${room}`,
    toPay: "দিবলগীয়া ধন",
    left: "বাকী থকা ধন",
    due: (d) => `শেষ তাৰিখ ${d}`,
    status: { unpaid: "বাকী", confirming: "বেংকৰ সৈতে নিশ্চিত কৰা হৈছে", partially_paid: "আংশিক পৰিশোধ", paid: "পৰিশোধ হ'ল" },
    payApp: "UPI এপেৰে পৰিশোধ কৰক",
    payWith: "অথবা পোনপটীয়াকৈ খোলক",
    appHint: "আপোনাৰ UPI এপ ধন ভৰাই খোল খাব। পৰিশোধৰ আগতে নামটো চাই লওক।",
    scan: "অথবা যিকোনো UPI এপেৰে এই QR স্কেন কৰক",
    manual: "নিজে পৰিশোধ কৰক",
    upiId: "UPI ID",
    payee: "নাম",
    upiNumber: "UPI নম্বৰ",
    copy: "কপি",
    copied: "কপি হ'ল",
    exact: (a) => `ঠিক ${a} পৰিশোধ কৰক। শেষৰ কেইপইচামানে আপোনাৰ পৰিশোধ আপোনাৰ বিলৰ সৈতে মিলোৱাত সহায় কৰে।`,
    warn: (p) => `কেৱল ${p}ক পৰিশোধ কৰক। RentFlow-এ কেতিয়াও আন কাকো পৰিশোধ কৰিবলৈ নকয়।`,
    details: "বিলৰ বিৱৰণ",
    total: "মুঠ",
    paidTitle: "পৰিশোধ হ'ল। ধন্যবাদ!",
    paidText: "আপোনাৰ পৰিশোধ বেংকৰ সৈতে নিশ্চিত হৈছে।",
    receipt: "ৰচিদ চাওক",
    confirmingText: "আমি বেংকৰ সৈতে আপোনাৰ পৰিশোধ নিশ্চিত কৰি আছোঁ। ৰচিদ WhatsApp-ত পাব।",
    partialText: "এই বিলৰ কিছু অংশ পোৱা গৈছে। অনুগ্ৰহ কৰি বাকীখিনি পৰিশোধ কৰক।",
    noUpi: "আপোনাৰ PG-এ এতিয়াও UPI ছেট কৰা নাই। কেনেকৈ পৰিশোধ কৰিব মেনেজাৰক সোধক।",
    invalid: "এই পৰিশোধ লিংকটো শুদ্ধ নহয়",
    invalidText: "এইটো সলনি কৰা হ'ব পাৰে। আপোনাৰ PG-ৰ WhatsApp বাৰ্তাৰ পৰা লিংকটো পুনৰ খোলক।",
    upload: {
      title: "পৰিশোধ কৰি পেলাইছে নেকি?",
      hint: "পৰিশোধৰ স্ক্ৰীণশ্বট পঠিয়াওক। আমি বেংকৰ সৈতে মিলাম; ধন নিশ্চিত হ'লে বিলখন পৰিশোধ হোৱা দেখুৱাব।",
      choose: "স্ক্ৰীণশ্বট বাছক",
      send: "স্ক্ৰীণশ্বট পঠিয়াওক",
      sending: "পঠিওৱা হৈছে…",
      saved: "ধন্যবাদ! আমি বেংকৰ সৈতে নিশ্চিত কৰি আছোঁ। ৰচিদ WhatsApp-ত পাব।",
      duplicate: "এই স্ক্ৰীণশ্বট আগতেই পঠিওৱা হৈছে। পুনৰ পৰিশোধ কৰিলে নতুনটো পঠিয়াওক।",
      invalid: "অনুগ্ৰহ কৰি আপোনাৰ পৰিশোধৰ PNG বা JPG ছবি বাছক।",
      missing: "প্ৰথমে আপোনাৰ স্ক্ৰীণশ্বট বাছক।",
      tooBig: "ছবিখন বেছি ডাঙৰ। 5 MB-তকৈ সৰু পঠিয়াওক।",
      error: "কিবা ভুল হ'ল। পুনৰ চেষ্টা কৰক।",
    },
  },
};
