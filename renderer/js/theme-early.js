// Early theme apply — prevents flash of wrong theme on app reopen.
// Runs before DOM renders. Reads cached theme from localStorage.
(function(){
  try{
    var t=localStorage.getItem('sb_theme');
    if(t&&t!=='system'){
      document.documentElement.setAttribute('data-theme',t);
    }else if(t==='system'){
      var light=window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches;
      document.documentElement.setAttribute('data-theme',light?'light':'dark');
    }
  }catch(e){}
})();
