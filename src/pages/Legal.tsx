import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { useLang } from '../lib/i18n'
import { LEGAL } from '../lib/legal'

type T = [string, string]
interface Section { h: T; p: T[] }
type Doc = 'privacy' | 'terms' | 'dpa'

const who: T = [LEGAL.company || 'the company that operates Bonyan', LEGAL.company || 'الشركة المشغّلة لبنيان']
const contact: T = [LEGAL.email || 'the contact address on this page (to be added)', LEGAL.email || 'عنوان التواصل في هذه الصفحة (سيُضاف)']

const DOCS: Record<Doc, { title: T; intro: T; sections: Section[] }> = {
  privacy: {
    title: ['Privacy Policy', 'سياسة الخصوصية'],
    intro: [
      `This policy explains what personal data Bonyan collects, why, where it is kept and the rights you have. Bonyan is operated by ${who[0]} (“we”). We follow Egypt’s Personal Data Protection Law No. 151 of 2020.`,
      `توضح هذه السياسة البيانات الشخصية التي يجمعها بنيان ولماذا وأين تُحفظ وما حقوقك. يُشغّل بنيان ${who[1]} („نحن“). نلتزم بقانون حماية البيانات الشخصية المصري رقم ١٥١ لسنة ٢٠٢٠.`,
    ],
    sections: [
      { h: ['Two kinds of data', 'نوعان من البيانات'], p: [
        ['Account data: your name, work e-mail, password (stored only as a secure hash), two-factor settings, and when you sign in. We are responsible for this data.', 'بيانات الحساب: اسمك وبريد العمل وكلمة المرور (تُحفظ مشفّرة فقط) وإعدادات التحقق بخطوتين وأوقات الدخول. نحن المسؤولون عن هذه البيانات.'],
        ['Business data: the customers, contacts, invoices, products and other records your company enters. Your company owns and controls this data; we process it only on your company’s instructions (see the Data Processing Agreement).', 'بيانات العمل: العملاء وجهات الاتصال والفواتير والمنتجات وغيرها مما تُدخله شركتك. شركتك تملك هذه البيانات وتتحكم فيها، ونحن نعالجها فقط بتعليمات شركتك (راجع اتفاقية معالجة البيانات).'],
      ] },
      { h: ['Why we use it', 'لماذا نستخدمها'], p: [
        ['To run the service: sign you in, keep your company’s records, enforce each role’s permissions, send the e-mails you ask for (confirmations, password resets, invitations) and keep an audit trail of changes.', 'لتشغيل الخدمة: تسجيل دخولك وحفظ سجلات شركتك وتطبيق صلاحيات كل دور وإرسال الرسائل التي تطلبها (التأكيد واستعادة كلمة المرور والدعوات) والاحتفاظ بسجل تدقيق للتغييرات.'],
        ['To keep it safe: detect abuse, limit attempts, and investigate problems. We do not sell personal data and do not use your business data for advertising.', 'للحفاظ على الأمان: اكتشاف إساءة الاستخدام وتقييد المحاولات وفحص المشكلات. لا نبيع البيانات الشخصية ولا نستخدم بيانات عملك في الإعلانات.'],
      ] },
      { h: ['Where it is kept', 'أين تُحفظ'], p: [
        [`Data is stored with our hosting provider Supabase in ${LEGAL.region.en}. Because this is outside Egypt, we transfer it under the conditions of the Personal Data Protection Law and its executive regulations, with a provider bound by strict security and confidentiality obligations. The app itself is served by Vercel and e-mails are sent through Resend.`, `تُحفظ البيانات لدى مزوّد الاستضافة Supabase في ${LEGAL.region.ar}. ولأن ذلك خارج مصر، ننقلها وفق شروط قانون حماية البيانات الشخصية ولائحته التنفيذية، لدى مزوّد ملتزم بالتزامات صارمة للأمن والسرية. يُقدَّم التطبيق عبر Vercel وتُرسل الرسائل عبر Resend.`],
      ] },
      { h: ['How long we keep it', 'مدة الاحتفاظ'], p: [
        ['Business data is kept while your company’s workspace is active. Earlier versions of changed records are kept 90 days. Posted journal, stock and payment entries are kept permanently because accounting law requires an unchangeable record. The audit trail is kept for the life of the workspace.', 'تُحفظ بيانات العمل طوال نشاط مساحة عمل شركتك. تُحفظ النسخ السابقة من السجلات المعدّلة ٩٠ يوماً. تُحفظ قيود اليومية والمخزون والمدفوعات المرحّلة بشكل دائم لأن القانون المحاسبي يتطلب سجلاً لا يتغير. يُحفظ سجل التدقيق طوال عمر مساحة العمل.'],
      ] },
      { h: ['Your rights', 'حقوقك'], p: [
        [`You may ask to see, correct or delete your personal data, to receive a copy, or to object to its use. Requests about your company’s business records go to your company’s admin. Write to us at ${contact[0]}; we answer within the period the law sets. You may also complain to Egypt’s Personal Data Protection Center.`, `يحق لك طلب الاطلاع على بياناتك الشخصية أو تصحيحها أو حذفها أو الحصول على نسخة منها أو الاعتراض على استخدامها. الطلبات الخاصة بسجلات شركتك توجَّه إلى مسؤول شركتك. راسلنا على ${contact[1]}، ونرد خلال المدة التي يحددها القانون. ويحق لك أيضاً تقديم شكوى إلى مركز حماية البيانات الشخصية.`],
      ] },
      { h: ['Security', 'الأمان'], p: [
        ['Every change is checked by our server and recorded; each role sees only what it is allowed to; data is encrypted in transit and at rest by our provider; two-factor login is available and can be required by your company.', 'كل تغيير يتحقق منه خادمنا ويُسجَّل، وكل دور يرى ما يُسمح له به فقط، والبيانات مشفّرة أثناء النقل والتخزين لدى مزوّدنا، والتحقق بخطوتين متاح ويمكن لشركتك فرضه.'],
      ] },
      { h: ['Cookies', 'ملفات تعريف الارتباط'], p: [
        ['We use only what is needed to keep you signed in and remember your choices (language, last company). No advertising or tracking cookies.', 'نستخدم فقط ما يلزم لإبقائك مسجلاً للدخول وتذكّر اختياراتك (اللغة وآخر شركة). لا نستخدم ملفات إعلانية أو للتتبع.'],
      ] },
    ],
  },
  terms: {
    title: ['Terms of Service', 'شروط الاستخدام'],
    intro: [
      `These terms are an agreement between your company and ${who[0]} for the use of Bonyan. By creating a workspace or accepting an invitation you accept them.`,
      `هذه الشروط اتفاق بين شركتك و${who[1]} لاستخدام بنيان. بإنشاء مساحة عمل أو قبول دعوة فإنك توافق عليها.`,
    ],
    sections: [
      { h: ['Your account', 'حسابك'], p: [
        ['Keep your password and two-factor device safe and tell your admin at once if you think someone else used your login. The person who creates a workspace is its owner and decides who may join and what each role may do.', 'حافظ على كلمة المرور وجهاز التحقق بخطوتين، وأبلغ المسؤول فوراً إن ظننت أن غيرك استخدم حسابك. منشئ مساحة العمل هو مالكها ويقرر من ينضم وما يحق لكل دور.'],
      ] },
      { h: ['Your data', 'بياناتك'], p: [
        ['Your company owns its business data. You can download a full copy at any time (Builder → Company → Download backup). You are responsible for having the right to enter the personal data of your customers and staff.', 'شركتك تملك بيانات عملها، ويمكنك تنزيل نسخة كاملة في أي وقت (المصمم ← الشركة ← تنزيل نسخة احتياطية). وأنت مسؤول عن امتلاك الحق في إدخال البيانات الشخصية لعملائك وموظفيك.'],
      ] },
      { h: ['Fair use', 'الاستخدام العادل'], p: [
        ['Do not use Bonyan for anything unlawful, try to reach other companies’ data, overload the service, or get around its limits and checks. We may suspend access that puts the service or other customers at risk.', 'لا تستخدم بنيان في أي أمر مخالف للقانون، ولا تحاول الوصول إلى بيانات شركات أخرى أو إثقال الخدمة أو تجاوز حدودها وضوابطها. ويحق لنا إيقاف أي وصول يعرّض الخدمة أو العملاء الآخرين للخطر.'],
      ] },
      { h: ['Accounting and tax', 'المحاسبة والضرائب'], p: [
        ['Bonyan keeps the books consistent (balanced entries, locked postings), but your company remains responsible for its accounts, tax returns and e-invoicing obligations. Have your accountant review figures before filing.', 'يحافظ بنيان على اتساق الدفاتر (قيود متوازنة وترحيلات مقفلة)، لكن شركتك تظل مسؤولة عن حساباتها وإقراراتها الضريبية والتزامات الفاتورة الإلكترونية. اجعل محاسبك يراجع الأرقام قبل التقديم.'],
      ] },
      { h: ['Availability and changes', 'التوفر والتغييرات'], p: [
        ['We work to keep Bonyan available and your data safe, with backups and an audit trail, but cannot promise it will never be interrupted. We may improve or change features; we will tell admins in advance about changes that affect them significantly.', 'نعمل على إبقاء بنيان متاحاً وبياناتك آمنة مع نسخ احتياطية وسجل تدقيق، لكن لا يمكننا ضمان عدم انقطاعه إطلاقاً. قد نطوّر الخصائص أو نغيّرها، وسنبلغ المسؤولين مسبقاً بالتغييرات التي تؤثر عليهم كثيراً.'],
      ] },
      { h: ['Ending', 'الإنهاء'], p: [
        ['You may stop at any time; download your data first. If a workspace is closed we keep its data for 30 days so it can be recovered, then delete it, except records the law requires us to keep.', 'يمكنك التوقف في أي وقت بعد تنزيل بياناتك. عند إغلاق مساحة عمل نحتفظ ببياناتها ٣٠ يوماً لإمكان استعادتها ثم نحذفها، باستثناء ما يُلزمنا القانون بالاحتفاظ به.'],
      ] },
      { h: ['Law', 'القانون الواجب التطبيق'], p: [
        ['These terms are governed by the laws of the Arab Republic of Egypt, and the courts of Cairo have jurisdiction.', 'تخضع هذه الشروط لقوانين جمهورية مصر العربية، وتختص محاكم القاهرة بنظر أي نزاع.'],
      ] },
    ],
  },
  dpa: {
    title: ['Data Processing Agreement', 'اتفاقية معالجة البيانات'],
    intro: [
      `For the business data your company enters, your company is the controller and ${who[0]} is the processor. This agreement is part of the Terms of Service.`,
      `بالنسبة لبيانات العمل التي تدخلها شركتك، شركتك هي المتحكم و${who[1]} هي المعالج. وتُعد هذه الاتفاقية جزءاً من شروط الاستخدام.`,
    ],
    sections: [
      { h: ['What we do with it', 'ما نفعله بها'], p: [
        ['We process business data only to provide Bonyan as your company configures it, and only on its documented instructions (the settings and actions in the app). Our staff access it only when needed to support you or keep the service safe, and are bound to confidentiality.', 'نعالج بيانات العمل فقط لتقديم بنيان كما تهيّئه شركتك، وفق تعليماتها الموثّقة (الإعدادات والإجراءات في التطبيق). ولا يصل إليها موظفونا إلا عند الحاجة لدعمك أو حماية الخدمة، وهم ملتزمون بالسرية.'],
      ] },
      { h: ['Security measures', 'إجراءات الأمان'], p: [
        ['Role-based access enforced by the server; append-only ledgers and audit trail; record history; encryption in transit and at rest; two-factor login; limits against abuse; backups.', 'صلاحيات حسب الدور يفرضها الخادم، ودفاتر وسجل تدقيق لا يمكن تعديلهما، وسجل للنسخ السابقة، وتشفير أثناء النقل والتخزين، وتحقق بخطوتين، وحدود ضد إساءة الاستخدام، ونسخ احتياطية.'],
      ] },
      { h: ['Sub-processors', 'المعالجون من الباطن'], p: [
        [`Supabase (database, login, server functions; data stored in ${LEGAL.region.en}), Vercel (serving the app), Resend (sending e-mails). We will tell admins before adding or replacing a sub-processor.`, `Supabase (قاعدة البيانات وتسجيل الدخول ووظائف الخادم؛ تُحفظ البيانات في ${LEGAL.region.ar})، وVercel (تقديم التطبيق)، وResend (إرسال الرسائل). وسنبلغ المسؤولين قبل إضافة أو تغيير أي معالج من الباطن.`],
      ] },
      { h: ['Breaches', 'الاختراقات'], p: [
        ['If we become aware of a breach affecting your company’s data we will inform the owner without undue delay, and in time for your company to meet its own duty to notify the Personal Data Protection Center.', 'إذا علمنا باختراق يمس بيانات شركتك فسنبلغ المالك دون تأخير غير مبرر، وفي وقت يسمح لشركتك بالوفاء بالتزامها بإخطار مركز حماية البيانات الشخصية.'],
      ] },
      { h: ['Help with requests, and the end', 'المساعدة في الطلبات وعند الانتهاء'], p: [
        ['We help your company answer people’s requests about their data. When the service ends, your company can export everything; we then delete the data as described in the Terms.', 'نساعد شركتك في الرد على طلبات الأفراد بشأن بياناتهم. وعند انتهاء الخدمة يمكن لشركتك تصدير كل شيء، ثم نحذف البيانات كما ورد في الشروط.'],
      ] },
    ],
  },
}

/** The legal pages, in English and Arabic (the language switch follows the rest of the app). */
export default function Legal({ doc }: { doc: Doc }) {
  const { lang, setLang } = useLang()
  const i = lang === 'ar' ? 1 : 0
  const d = DOCS[doc]
  const links: [Doc, T][] = [['privacy', DOCS.privacy.title], ['terms', DOCS.terms.title], ['dpa', DOCS.dpa.title]]
  return (
    <div className="page" style={{ maxWidth: 780, margin: '0 auto' }}>
      <div className="page-head">
        <Link to="/"><Logo /></Link>
        <button className="ghost small" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
      </div>
      <div className="card stack">
        <h1>{d.title[i]}</h1>
        <p className="tiny muted">{i ? 'سارية من' : 'Effective'} {LEGAL.effective}{LEGAL.draft && (i ? ' · مسودة قيد المراجعة القانونية' : ' · Draft under legal review')}</p>
        <p>{d.intro[i]}</p>
        {d.sections.map((s) => (
          <section key={s.h[0]}>
            <h2>{s.h[i]}</h2>
            {s.p.map((p) => <p key={p[0].slice(0, 30)}>{p[i]}</p>)}
          </section>
        ))}
        {(LEGAL.company || LEGAL.address || LEGAL.email) && (
          <p className="small muted">{[LEGAL.company, LEGAL.address, LEGAL.email].filter(Boolean).join(' · ')}</p>
        )}
        <p className="small">{links.filter(([k]) => k !== doc).map(([k, t], n) => <span key={k}>{n > 0 && ' · '}<Link to={`/${k}`}>{t[i]}</Link></span>)}</p>
      </div>
    </div>
  )
}
