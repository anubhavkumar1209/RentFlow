// Draft translation: needs review by a native Odia speaker before launch.
// WhatsApp doesn't offer Odia for business messages (Meta's template languages), so the
// WhatsApp side is Hindi; the pay page and the app are in Odia.
import { hi } from "./hi";
import type { LanguagePack } from "./types";

export const or: LanguagePack = {
  ...hi,
  payPage: {
    hi: (n) => `ନମସ୍କାର ${n}`,
    bill: (period, room) => `${period} ବିଲ୍ · ରୁମ୍ ${room}`,
    toPay: "ଦେୟ ରାଶି",
    left: "ବାକି ରାଶି",
    due: (d) => `ଶେଷ ତାରିଖ ${d}`,
    status: { unpaid: "ବାକି", confirming: "ବ୍ୟାଙ୍କ ସହିତ ନିଶ୍ଚିତ କରାଯାଉଛି", partially_paid: "ଆଂଶିକ ପେମେଣ୍ଟ", paid: "ପେମେଣ୍ଟ ହୋଇଗଲା" },
    payApp: "UPI ଆପ୍‌ରେ ପେମେଣ୍ଟ କରନ୍ତୁ",
    payWith: "କିମ୍ବା ସିଧାସଳଖ ଖୋଲନ୍ତୁ",
    appHint: "ଆପଣଙ୍କ UPI ଆପ୍ ରାଶି ଭରି ଖୋଲିବ। ପେମେଣ୍ଟ ପୂର୍ବରୁ ନାମ ଯାଞ୍ଚ କରନ୍ତୁ।",
    scan: "କିମ୍ବା ଯେକୌଣସି UPI ଆପ୍‌ରେ ଏହି QR ସ୍କାନ୍ କରନ୍ତୁ",
    manual: "ନିଜେ ପେମେଣ୍ଟ କରନ୍ତୁ",
    upiId: "UPI ID",
    payee: "ନାମ",
    upiNumber: "UPI ନମ୍ବର",
    copy: "କପି",
    copied: "କପି ହେଲା",
    exact: (a) => `ଠିକ୍ ${a} ପେମେଣ୍ଟ କରନ୍ତୁ। ଶେଷ କିଛି ପଇସା ଆପଣଙ୍କ ପେମେଣ୍ଟକୁ ଆପଣଙ୍କ ବିଲ୍ ସହିତ ମିଳାଇବାରେ ସାହାଯ୍ୟ କରେ।`,
    warn: (p) => `କେବଳ ${p}ଙ୍କୁ ପେମେଣ୍ଟ କରନ୍ତୁ। RentFlow କେବେ ବି ଅନ୍ୟ କାହାକୁ ପେମେଣ୍ଟ କରିବାକୁ କହେ ନାହିଁ।`,
    details: "ବିଲ୍ ବିବରଣୀ",
    total: "ମୋଟ",
    paidTitle: "ପେମେଣ୍ଟ ହୋଇଗଲା। ଧନ୍ୟବାଦ!",
    paidText: "ଆପଣଙ୍କ ପେମେଣ୍ଟ ବ୍ୟାଙ୍କ ସହିତ ନିଶ୍ଚିତ ହୋଇଛି।",
    receipt: "ରସିଦ ଦେଖନ୍ତୁ",
    confirmingText: "ଆମେ ବ୍ୟାଙ୍କ ସହିତ ଆପଣଙ୍କ ପେମେଣ୍ଟ ନିଶ୍ଚିତ କରୁଛୁ। ରସିଦ WhatsApp ରେ ମିଳିବ।",
    partialText: "ଏହି ବିଲ୍‌ର କିଛି ଅଂଶ ମିଳିଛି। ଦୟାକରି ବାକି ପେମେଣ୍ଟ କରନ୍ତୁ।",
    noUpi: "ଆପଣଙ୍କ PG ଏପର୍ଯ୍ୟନ୍ତ UPI ସେଟ୍ କରିନାହିଁ। କିପରି ପେମେଣ୍ଟ କରିବେ ମ୍ୟାନେଜରଙ୍କୁ ପଚାରନ୍ତୁ।",
    invalid: "ଏହି ପେମେଣ୍ଟ ଲିଙ୍କ୍ ଠିକ୍ ନୁହେଁ",
    invalidText: "ଏହା ବଦଳାଯାଇଥାଇପାରେ। ଆପଣଙ୍କ PG ର WhatsApp ମେସେଜ୍‌ରୁ ଲିଙ୍କ୍ ପୁଣି ଖୋଲନ୍ତୁ।",
    upload: {
      title: "ପେମେଣ୍ଟ କରିସାରିଛନ୍ତି?",
      hint: "ପେମେଣ୍ଟର ସ୍କ୍ରିନସଟ୍ ପଠାନ୍ତୁ। ଆମେ ବ୍ୟାଙ୍କ ସହିତ ମିଳାଇବୁ; ଟଙ୍କା ନିଶ୍ଚିତ ହେଲେ ବିଲ୍ ପେମେଣ୍ଟ ହୋଇଥିବା ଦେଖାଇବ।",
      choose: "ସ୍କ୍ରିନସଟ୍ ବାଛନ୍ତୁ",
      send: "ସ୍କ୍ରିନସଟ୍ ପଠାନ୍ତୁ",
      sending: "ପଠାଯାଉଛି…",
      saved: "ଧନ୍ୟବାଦ! ଆମେ ବ୍ୟାଙ୍କ ସହିତ ନିଶ୍ଚିତ କରୁଛୁ। ରସିଦ WhatsApp ରେ ମିଳିବ।",
      duplicate: "ଏହି ସ୍କ୍ରିନସଟ୍ ପୂର୍ବରୁ ପଠାଯାଇଛି। ପୁଣି ପେମେଣ୍ଟ କରିଥିଲେ ନୂଆଟି ପଠାନ୍ତୁ।",
      invalid: "ଦୟାକରି ଆପଣଙ୍କ ପେମେଣ୍ଟର PNG କିମ୍ବା JPG ଛବି ବାଛନ୍ତୁ।",
      missing: "ପ୍ରଥମେ ଆପଣଙ୍କ ସ୍କ୍ରିନସଟ୍ ବାଛନ୍ତୁ।",
      tooBig: "ଛବିଟି ବହୁତ ବଡ଼। 5 MB ରୁ ଛୋଟ ପଠାନ୍ତୁ।",
      error: "କିଛି ଭୁଲ୍ ହେଲା। ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",
    },
  },
};
