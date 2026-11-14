export const toggleSidebar=()=>{
document.getElementById('gpt-sidebar-toggle').addEventListener('click',function(){
  document.getElementById('gpt-side-bar').style.width == '0%' ? document.getElementById('gpt-side-bar').style.width = '80%' : document.getElementById('gpt-side-bar').style.width = '0%' ;
});
} ;

