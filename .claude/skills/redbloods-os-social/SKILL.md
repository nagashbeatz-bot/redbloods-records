---
name: redbloods-os-social
description: >
  Use when working on the Social module of Redbloods OS — routes /social,
  /social-legacy, /social-hub-preview, or the social_campaigns and
  social_content_items models. Covers content workflow, campaign-to-project
  linking, status pipeline, Hebrew RTL UI rules, and the safety boundaries
  that separate Social from Dropbox/LISTEN/Radio.
---

# Redbloods OS — סקיל מודול סושיאל

## מטרה

הסקיל הזה מגדיר איך לעבוד בצורה בטוחה ועקבית על מודול הסושיאל של Redbloods OS.

להשתמש בסקיל הזה כשעובדים על:

- `/social`
- `/social-legacy`
- `/social-hub-preview`
- `social_campaigns`
- `social_content_items`
- כרטיסי קמפיינים
- תכנון תוכן שבועי
- כרטיסי preview לתוכן
- סטטוסים של תוכן
- קישור קמפיין לפרויקט
- העלאות / תצוגות מקדימות של תוכן סושיאל
- פילטרים של סושיאל
- UI של לוח תוכן / קמפיינים

---

## הקשר עסקי

Redbloods Records הוא לייבל וסטודיו מוזיקה שעובד בעברית.

המערכת מנהלת בין היתר:

- פרויקטים מוזיקליים
- אמנים
- לקוחות
- הצעות מחיר
- כספים
- קליפים
- סשנים
- מיקסים / מאסטרים
- קבצי Dropbox
- קמפיינים לסושיאל
- דוחות פנימיים
- context עבור Mai AI

מודול Social הוא אזור ניהול התוכן והשיווק של Redbloods OS.

המטרה שלו היא לחבר בין פרויקטים מוזיקליים, קליפים, סינגלים, סשנים וקמפיינים של אמנים — לבין תכנון תוכן לרשתות.

---

## מה הסושיאל של Redbloods כולל

תוכן סושיאל ב-Redbloods בדרך כלל כולל:

- טיזרים לקליפים
- BTS מצילומים
- קטעים מסשנים באולפן
- הכרזות על סינגלים / קליפים
- תכנים לאמנים
- תכנון סרטונים שבועי
- Reels / TikTok / Shorts
- סטוריז
- קמפיינים סביב שחרורים
- קידום לינקים סביב שחרור

פלטפורמות מרכזיות:

- Instagram
- TikTok
- YouTube
- לפעמים Spotify / Link promotion כחלק משחרור

---

## הטון של Redbloods בסושיאל

החלק הזה רלוונטי רק ל-copy, טקסטים, כותרות, empty states והודעות UI.

אסור לתת ל״טון״ להשפיע על:

- לוגיקה
- DB
- schema
- שמות שדות
- סטטוסים
- הרשאות
- חישובים

הטון הרצוי:

- ישראלי
- רחוב אבל מקצועי
- חד
- ישיר
- אנרגטי
- לא תאגידי
- מרגיש כמו לייבל / סטודיו אמיתי
- מחובר למוזיקה, קליפים, אמנים, BTS ושחרורים

להימנע מ:

- שפה תאגידית מדי
- משפטי שיווק גנריים
- הייפ מזויף
- UI באנגלית כשצריך עברית

---

## כללי ברזל — אסור בלי אישור מפורש

אסור לבצע את הדברים הבאים בלי אישור מפורש מהמשתמש:

1. לא לשנות DB / schema / migrations של `social_campaigns` או `social_content_items`.
2. לא להריץ SQL.
3. לא למחוק campaigns.
4. לא למחוק content items.
5. לא לשנות upload/delete logic בלי אישור.
6. לא לשנות Dropbox integration logic בלי אישור.
7. לא לערבב Social Dropbox עם Project Dropbox.
8. לא לערבב Social עם LISTEN / Radio.
9. לא להוסיף Push Notifications לסושיאל בלי אישור.
10. לא להוסיף Cron jobs לסושיאל בלי אישור.
11. לא להוסיף Agent Alerts לסושיאל בלי אישור.
12. לא להוסיף AI analysis לסושיאל בלי אישור מפורש.
13. לא לשנות `package.json`.
14. לא להוסיף dependencies.
15. לא ליצור פיצ׳רים חדשים באמצע QA בלי אישור מפורש.

אם משימה נוגעת באחד מהאזורים האלה:

- לעצור
- לעבוד ב-PLAN בלבד
- להסביר את הסיכון
- לחכות לאישור

---

## מה מותר ב-AUTO

AUTO מותר רק לשינויים בטוחים ומוגבלים היטב, כמו:

- UI layout
- תיקוני responsive / mobile
- שינויי copy בעברית
- תיקוני RTL
- צבעי סטטוסים
- עיצוב preview cards
- UI של פילטרים קיימים
- spacing
- empty states
- loading states
- ליטוש ויזואלי

AUTO לא מותר אם השינוי נוגע ב:

- DB
- schema
- SQL
- מחיקה
- upload/delete logic
- Dropbox integration behavior
- Push
- Cron
- Agent Alerts
- project linking logic
- finance logic
- authentication / permissions
- dependencies חדשות

כשיש ספק — לעבוד ב-PLAN.

---

## כללי UI

כל UI שמוצג למשתמש חייב להיות בעברית.

זה כולל:

- כפתורים
- labels
- סטטוסים
- empty states
- פילטרים
- כרטיסים
- alerts
- דוחות
- helper text
- context של Mai AI שקשור לסושיאל

המערכת בעברית וב-RTL כברירת מחדל.

לא להכניס סטטוסים באנגלית כמו:

- draft
- published
- scheduled
- review

להשתמש רק בסטטוסים המאושרים בעברית.

---

## סטטוסים מאושרים לתוכן סושיאל

צינור הסטטוסים המאושר הוא:

1. רעיון
2. צריך צילום
3. צולם
4. בעריכה
5. ממתין לבדיקה
6. מוכן להעלאה
7. תוזמן
8. פורסם
9. בוטל

משמעות הסטטוסים:

- רעיון — יש רעיון לתוכן, עדיין לא מוכן להפקה.
- צריך צילום — התוכן דורש צילום.
- צולם — החומר צולם / נאסף.
- בעריכה — התוכן נמצא בעריכה.
- ממתין לבדיקה — התוכן מחכה לבדיקה / אישור.
- מוכן להעלאה — התוכן מוכן להעלאה.
- תוזמן — התוכן כבר תוזמן לפרסום.
- פורסם — התוכן פורסם.
- בוטל — התוכן בוטל.

חשוב:

- לא להמציא סטטוסים חדשים בלי אישור.
- לא לתרגם את הערכים האלה לאנגלית ב-UI.
- "בוטל" הוא סטטוס, לא מחיקה.
- ביטול תוכן לא שווה למחיקת תוכן.

---

## Routes

- `/social` — מרכז הסושיאל החדש. זה העמוד הראשי לעבודה הנוכחית.
- `/social-legacy` — העמוד הישן, נשמר כגיבוי. לא לפתח בו פיצ׳רים חדשים בלי אישור.
- `/social-hub-preview` — עמוד preview / design של מרכז הסושיאל.

לא להחליף, למחוק או להסיר routes קיימים בלי אישור.

---

## גבולות מודל הנתונים

המידע כאן הוא להבנה בלבד, אלא אם המשתמש אישר שינוי קוד / schema.

### `social_campaigns`

מייצג קמפיין לאמן, שחרור, פרויקט או פעילות תוכן.

כללים חשובים:

- קמפיין יכול להיות מקושר לפרויקט דרך `project_id`.
- `campaign.project_id` הוא הקישור הקנוני לפרויקט.
- אם `campaign.project_id` קיים, אסור להציג "לא מקושר לפרויקט".
- לא ליצור לוגיקת קישור כפולה לפרויקטים.
- לא להמציא `client_id` או קשרים חדשים בלי אישור.

### `social_content_items`

מייצג פריט תוכן בודד בתוך קמפיין או קשור לקמפיין.

דוגמאות:

- סרטון טיזר
- BTS
- Reel
- TikTok
- Story
- YouTube Short
- פוסט הכרזה

כללים חשובים:

- content items צריכים להשתמש בצינור הסטטוסים המאושר בעברית.
- לא למחוק content items בלי אישור.
- לא לשנות upload/delete behavior בלי אישור.
- לא להוסיף שדות חובה חדשים בלי PLAN ואישור.

---

## חוק קישור לפרויקט

לפני שמציגים "לא מקושר לפרויקט", תמיד לבדוק אם `campaign.project_id` קיים.

התנהגות נכונה:

- אם `campaign.project_id` קיים — להציג שהקמפיין מקושר לפרויקט.
- אם `campaign.project_id` לא קיים — רק אז להציג "לא מקושר לפרויקט".

לא להסתמך רק על שם פרויקט כטקסט.

לא לשבור התנהגות קיימת של קישור לפרויקט.

לא ליצור פרויקטים כפולים מתוך Social בלי אישור מפורש.

---

## גבולות Dropbox / קבצים

לא לערבב בין:

- העלאות תוכן של Social
- Project Dropbox files
- LISTEN / Radio audio

אלה אזורים נפרדים.

כללים:

- Social previews יכולים להציג קבצי תוכן של Social אם זה כבר נתמך.
- Project Dropbox שייך לקבצי פרויקט.
- LISTEN / Radio הוא אזור אודיו / רדיו חיצוני, לא Social.
- לא לשנות upload/delete logic בלי אישור.

---

## AI Analysis

AI analysis לסושיאל יכול להיות שימושי בעתיד, אבל הוא לא מאושר כברירת מחדל.

לא להוסיף בלי אישור:

- AI scoring
- AI content analysis
- AI recommendations
- AI auto captions
- AI campaign summaries
- AI alerts

כל דבר כזה דורש אישור נפרד.

---

## Production workflow

כל שינוי קוד מאושר לא נחשב גמור אם הוא לא עבר את השלבים הבאים:

1. typecheck
2. local check / build
3. סקירת diff
4. commit
5. push
6. Railway deploy
7. production check

דיווח סופי חייב לכלול:

- מצב עבודה: PLAN או AUTO
- קבצים ששונו
- תוצאת typecheck
- תוצאת local check / build
- commit hash
- סטטוס push
- סטטוס Railway deploy
- סטטוס production
- מה המשתמש צריך לבדוק ידנית

אם שלב נכשל:

- לעצור
- לדווח על הכשל
- לא להמשיך לשלב הבא

לשינויי documentation בלבד בתוך `.claude/skills`, אין צורך Railway deploy כל עוד לא השתנה קוד אפליקציה.

---

## פורמט דיווח בסיום משימת Social

בסוף כל משימת קוד בסושיאל, לדווח:

- מה השתנה
- במה לא נגעתי
- אילו קבצים השתנו
- האם DB / schema / SQL לא נגעו
- האם Push / Cron / Agent Alerts לא נגעו
- האם Dropbox upload/delete logic לא נגע
- תוצאת typecheck
- commit hash אם בוצע commit
- סטטוס push / deploy
- מה לבדוק ידנית

---

## התנהגות ברירת מחדל

כשעובדים על Social:

- להעדיף PLAN לבאגים לא ברורים
- לא לנחש שורש בעיה
- לזהות קודם קובץ / קומפוננטה / route / state / תנאי מדויק
- לא לעשות cleanup רחב
- לא להוסיף פיצ׳רים חדשים בלי אישור
- לשמור UI בעברית וב-RTL
- לשמור את `/social-legacy` כגיבוי
- לשמור את `/social` כמרכז הסושיאל החדש
- לשמור את `/social-hub-preview` כעמוד preview / design

כשיש ספק:

PLAN קודם. לא לערוך קוד.
