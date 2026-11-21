/* Service Worker für Push-Erinnerungen (Firebase Cloud Messaging) und die installierbare App.
   Liegt neben index.html, damit der Scope /fettsaecke/ ist (GitHub Pages).
   Die Config muss zu CONFIG.firebase in index.html passen (sie ist öffentlich, Schutz läuft über die Regeln). */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBurXm-bT9lu_O_QddU_eUO2MwkjgmXUmo',
  authDomain: 'club-der-fettsaecke.firebaseapp.com',
  projectId: 'club-der-fettsaecke',
  storageBucket: 'club-der-fettsaecke.firebasestorage.app',
  messagingSenderId: '121079785562',
  appId: '1:121079785562:web:a808ec1074af013dd49063',
});

// Nachrichten mit "notification"-Teil zeigt das SDK im Hintergrund selbst an,
// ein Klick öffnet webpush.fcmOptions.link (vom Versand-Skript gesetzt).
firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
