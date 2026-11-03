NetFlex lodge link
==================

Connects the lodge's Omada controller (on this computer) to netflexhq.com, so
paying residents are switched on and off automatically. It only connects OUT to
netflexhq.com; nothing needs opening on the router.

Needs: Windows 10/11, Node.js LTS (https://nodejs.org), the Omada Software
Controller on this computer, and a Hotspot operator account in the controller.

1. Unzip this folder to C:\NetFlex\lodge-link
2. Open PowerShell as Administrator in that folder and run:
     node lodge-link.mjs setup
   (controller address is usually https://127.0.0.1:8043)
3. In the office (netflexhq.com/admin -> Network -> Lodge link) press "Pair",
   then here run:
     node lodge-link.mjs pair ABCD-EFGH
4. Check everything answers:
     node lodge-link.mjs check
5. Install it to start with the computer:
     powershell -ExecutionPolicy Bypass -File .\install.ps1

The office's Network page shows it as "Online" within a minute.
Log file: lodge-link.log in this folder.
