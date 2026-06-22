const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/tamanos', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_tamano ORDER BY onzas')).rows);
}));

router.get('/leches', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_leche WHERE activo ORDER BY etiqueta')).rows);
}));

router.get('/cafes', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_cafe WHERE activo ORDER BY etiqueta')).rows);
}));

router.get('/extras', asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM opciones_extra WHERE activo ORDER BY etiqueta')).rows);
}));

module.exports = router;
