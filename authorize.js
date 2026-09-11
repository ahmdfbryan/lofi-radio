// Jalankan sekali di VPS: node authorize.js
// Script ini akan memunculkan wizard interaktif dari play-dl untuk
// menyimpan cookie/token YouTube, supaya request dari VPS tidak
// dianggap bot oleh YouTube ("Initial Response Data is undefined").
const play = require('play-dl');

play.authorization();
