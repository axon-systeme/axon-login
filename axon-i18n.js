/* AXON — ترجمة تلقائية لصفحات الأرشفة (axon-archiving.html و axon-section.html)
   تعتمد على دالة i18n-translate، وعلى متغيرات الصفحة: SUPABASE_URL و headers() و sessionToken.
   لا تغيّر أي شيء إذا كانت اللغة عربية. */
(function(){
  'use strict';

  var FN = 'i18n-translate';
  function lang(){ return localStorage.getItem('axon_lang') || 'ar'; }
  if(lang() === 'ar') return;
  if(typeof SUPABASE_URL === 'undefined' || typeof headers !== 'function' || typeof sessionToken === 'undefined') return;

  var AR = /[\u0621-\u064A]/;

  // عناصر فيها بيانات أشخاص أو مستخدمين: لا تُرسل أبدًا لخدمة الترجمة
  var SKIP = [
    '[translate="no"]', 'script', 'style', 'textarea', 'input', 'option',
    '#archiverName', '#accountNameLabel', '#orgName', '#sheetSub',
    '.stu-name', '.chip', '.seccard .name', '#app .card > h2',
    '.docrow > div:first-child',
    '.archive-item .head span:last-child', '.archive-item td:first-child'
  ].join(',');

  // نصوص من الشكل «عنوان: قيمة»: نترجم العنوان فقط ونترك القيمة كما هي
  var LABELED = '.info div, .archive-item .meta, .confirm-box, #fileName';

  // كلمات ثابتة داخل نصوص فيها أسماء: تُستبدل محليًا دون إرسال أي شيء
  var LOCAL = {
    fr: { 'تلميذ': 'élève(s)', 'بدون أستاذ': 'Sans enseignant', 'بدون قسم': 'Sans classe' },
    en: { 'تلميذ': 'student(s)', 'بدون أستاذ': 'No teacher', 'بدون قسم': 'No class' }
  };
  var LOCAL_SEL = '.seccard .meta';

  var cache = {};
  var tried = {};
  var timer = null;
  var running = false;

  function skipped(el){
    if(el.closest('.sum-row')) return false;
    return !!el.closest(SKIP);
  }

  function keyOf(node, text){
    var el = node.parentElement;
    if(el && el.closest(LABELED)){
      var i = text.indexOf(':');
      if(i > 0 && i < 40) return text.slice(0, i).trim();
    }
    return text;
  }

  function collect(){
    var items = [];
    var dict = LOCAL[lang()] || {};
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n;
    while((n = w.nextNode())){
      var el = n.parentElement;
      if(!el) continue;
      var t = n.nodeValue.trim();
      if(!t || !AR.test(t)) continue;

      if(el.closest(LOCAL_SEL)){
        var v = n.nodeValue;
        Object.keys(dict).forEach(function(k){ v = v.split(k).join(dict[k]); });
        if(v !== n.nodeValue) n.nodeValue = v;
        continue;
      }
      if(skipped(el)) continue;
      items.push({ node: n, key: keyOf(n, t) });
    }
    document.querySelectorAll('[placeholder]').forEach(function(e){
      var p = e.getAttribute('placeholder') || '';
      if(AR.test(p) && !e.closest('[translate="no"]')) items.push({ el: e, key: p.trim() });
    });
    return items;
  }

  function apply(it){
    var tr = cache[it.key];
    if(!tr) return;
    if(it.node){
      var cur = it.node.nodeValue;
      if(cur.indexOf(it.key) > -1) it.node.nodeValue = cur.replace(it.key, function(){ return tr; });
    }else if(it.el){
      it.el.setAttribute('placeholder', tr);
    }
  }

  function post(texts){
    return fetch(SUPABASE_URL + '/functions/v1/' + FN, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ session_token: sessionToken, lang: lang(), texts: texts })
    }).then(function(r){ return r.json(); });
  }

  function fetchKeys(keys){
    var jobs = [];
    for(var i = 0; i < keys.length; i += 100){
      (function(chunk){
        jobs.push(post(chunk).then(function(d){
          if(d && d.success && d.translations){
            Object.keys(d.translations).forEach(function(k){ cache[k] = d.translations[k]; });
          }else{
            chunk.forEach(function(k){ delete tried[k]; });
          }
        }).catch(function(){
          chunk.forEach(function(k){ delete tried[k]; });
        }));
      })(keys.slice(i, i + 100));
    }
    return Promise.all(jobs);
  }

  function run(){
    if(running){ schedule(); return; }
    running = true;
    var items = collect();
    var need = [];
    items.forEach(function(it){
      if(cache[it.key]) apply(it);
      else if(!tried[it.key] && need.indexOf(it.key) < 0) need.push(it.key);
    });
    if(!need.length){ running = false; return; }
    need.forEach(function(k){ tried[k] = true; });
    fetchKeys(need).then(function(){
      collect().forEach(apply);
    }).then(function(){ running = false; }, function(){ running = false; });
  }

  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  }

  // رسائل alert() تُترجم قبل أن تظهر (مع مهلة 2.5 ثانية ثم تظهر بالعربية)
  var nativeAlert = window.alert.bind(window);
  window.alert = function(msg){
    var text = String(msg);
    if(!AR.test(text)) return nativeAlert(text);
    var shown = false;
    function show(t){ if(shown) return; shown = true; nativeAlert(t); }
    setTimeout(function(){ show(text); }, 2500);
    if(cache[text]) return show(cache[text]);
    post([text]).then(function(d){
      var tr = d && d.translations && d.translations[text];
      if(tr) cache[text] = tr;
      show(tr || text);
    }).catch(function(){ show(text); });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('load', schedule);
  schedule();
})();
