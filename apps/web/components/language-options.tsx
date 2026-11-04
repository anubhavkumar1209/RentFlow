import { LANGUAGE_CODES, LANGUAGES } from "@rentflow/core";

/** "தமிழ் · Tamil": the language's own name first, so people find theirs at a glance. */
export function languageLabel(code: (typeof LANGUAGE_CODES)[number]): string {
  const l = LANGUAGES[code];
  return l.native === l.english ? l.english : `${l.native} · ${l.english}`;
}

/** <option>s for every language RentFlow speaks, for any <select name="language">. */
export function LanguageOptions() {
  return (
    <>
      {LANGUAGE_CODES.map((code) => (
        <option key={code} value={code}>
          {languageLabel(code)}
        </option>
      ))}
    </>
  );
}
