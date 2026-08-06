# Lista de arquivos do acervo

Worklist para preencher a pasta `fichas/`. Cada linha é **um arquivo PDF** —
alguns atendem a mais de um agravo (a ficha de Dengue serve Chikungunya; a de
doenças exantemáticas serve Sarampo e Rubéola).

**Salve cada PDF nesta pasta com exatamente o nome da coluna "Arquivo".** É por
esse nome que o sistema encontra a ficha e a entrega ao médico.

Legenda: ⏱ notificação imediata · ⚠ gatilho imediato · 📅 semanal

Gerado a partir de `assets/js/dados-fichas.js` (catálogo versão 1.0).
Total: **66 arquivos** para 69 agravos.

---

## Com link oficial cadastrado (6)

Estes o script baixa sozinho: `node scripts/baixar-fichas.js`

| ✓ | Arquivo | Agravo(s) | Link |
|---|---|---|---|
| ☐ | `dengue-chikungunya.pdf` | ⚠ Chikungunya; Dengue | [PDF](https://portalsinan.saude.gov.br/images/documentos/Agravos/Dengue/Ficha_DENGCHIK_FINAL.pdf) |
| ☐ | `febre-maculosa.pdf` | ⏱ Febre maculosa e outras riquetsioses | [PDF](https://portalsinan.saude.gov.br/images/documentos/Agravos/Febre%20Maculosa/Febre_Maculosa_v5.pdf) |
| ☐ | `febre-nilo-ocidental.pdf` | ⏱ Febre do Nilo Ocidental e outras arboviroses de importância em saúde pública | [PDF](https://portalsinan.saude.gov.br/images/documentos/Agravos/Febre_do_Nilo/FEBRE_DO_NILO.pdf) |
| ☐ | `ficha-conclusao.pdf` | 📅 Ficha de conclusão (encerramento de caso) | [PDF](https://portalsinan.saude.gov.br/images/documentos/Agravos/NINDIV/Ficha_conclusao_v5.pdf) |
| ☐ | `hepatites-virais.pdf` | 📅 Hepatites virais | [PDF](https://portalsinan.saude.gov.br/images/documentos/Agravos/Hepatites_Virais/Ficha_Hepatites_Virais.pdf) |
| ☐ | `notificacao-individual.pdf` | 📅 Notificação individual (ficha genérica do Sinan) | [PDF](https://portalsinan.saude.gov.br/images/documentos/Agravos/NINDIV/Notificacao_Individual_v5.pdf) |

---

## Sem link cadastrado — baixar manualmente (60)

Procure cada ficha em <https://portalsinan.saude.gov.br/notificacoes>, baixe o PDF e salve-o aqui
com o nome indicado. Aproveite para preencher o campo `urlOficial` do
catálogo com o endereço encontrado — assim o script passa a cuidar dele nas
próximas atualizações.

| ✓ | Arquivo | Agravo(s) |
|---|---|---|
| ☐ | `acidente-animais-peconhentos.pdf` | 📅 Acidente por animais peçonhentos |
| ☐ | `acidente-material-biologico.pdf` | 📅 Acidente de trabalho com exposição a material biológico |
| ☐ | `acidente-trabalho-grave.pdf` | 📅 Acidente de trabalho grave, fatal ou em crianças e adolescentes |
| ☐ | `antraz-carbunculo.pdf` | ⏱ Antraz pneumônico (carbúnculo) |
| ☐ | `atendimento-antirrabico.pdf` | 📅 Atendimento antirrábico humano (profilaxia) |
| ☐ | `botulismo.pdf` | ⏱ Botulismo |
| ☐ | `cancer-relacionado-trabalho.pdf` | 📅 Câncer relacionado ao trabalho |
| ☐ | `colera.pdf` | ⏱ Cólera |
| ☐ | `coqueluche.pdf` | ⏱ Coqueluche |
| ☐ | `dermatoses-ocupacionais.pdf` | 📅 Dermatoses ocupacionais |
| ☐ | `difteria.pdf` | ⏱ Difteria |
| ☐ | `doenca-chagas-aguda.pdf` | ⏱ Doença de Chagas aguda |
| ☐ | `doenca-chagas-cronica.pdf` | 📅 Doença de Chagas crônica |
| ☐ | `doencas-exantematicas.pdf` | ⏱ Rubéola; Sarampo |
| ☐ | `doencas-febris-hemorragicas.pdf` | ⏱ Doenças febris hemorrágicas emergentes e reemergentes |
| ☐ | `doencas-relacionadas-trabalho.pdf` | 📅 Doenças relacionadas ao trabalho (demais agravos) |
| ☐ | `esavi.pdf` | ⏱ Evento adverso grave pós-vacinação (ESAVI) |
| ☐ | `esporotricose.pdf` | 📅 Esporotricose humana |
| ☐ | `esquistossomose.pdf` | 📅 Esquistossomose |
| ☐ | `evento-saude-publica.pdf` | ⏱ Evento de saúde pública (ESP) que constitua ameaça à saúde pública |
| ☐ | `febre-amarela.pdf` | ⏱ Febre amarela |
| ☐ | `febre-oropouche.pdf` | ⚠ Febre do Oropouche |
| ☐ | `febre-tifoide.pdf` | ⏱ Febre tifoide |
| ☐ | `hanseniase.pdf` | 📅 Hanseníase |
| ☐ | `hantavirose.pdf` | ⏱ Hantavirose |
| ☐ | `hiv-aids.pdf` | 📅 HIV/aids — adulto e criança |
| ☐ | `hiv-gestante.pdf` | 📅 HIV em gestante, parturiente, puérpera e criança exposta |
| ☐ | `influenza-novo-subtipo.pdf` | ⏱ Influenza humana produzida por novo subtipo viral |
| ☐ | `intoxicacao-exogena.pdf` | 📅 Intoxicação exógena |
| ☐ | `leishmaniose-tegumentar.pdf` | 📅 Leishmaniose tegumentar americana |
| ☐ | `leishmaniose-visceral.pdf` | 📅 Leishmaniose visceral |
| ☐ | `leptospirose.pdf` | 📅 Leptospirose |
| ☐ | `ler-dort.pdf` | 📅 LER/DORT — lesões por esforços repetitivos |
| ☐ | `malaria.pdf` | ⚠ Malária |
| ☐ | `meningite.pdf` | ⏱ Doença meningocócica; Meningites (demais etiologias) |
| ☐ | `mpox.pdf` | ⏱ Mpox (varíola dos macacos) |
| ☐ | `obito-infantil-fetal.pdf` | ⏱ Óbito infantil e fetal |
| ☐ | `obito-materno.pdf` | ⏱ Óbito materno |
| ☐ | `pair.pdf` | 📅 PAIR — perda auditiva induzida por ruído |
| ☐ | `paralisia-flacida-aguda.pdf` | ⏱ Paralisia flácida aguda / poliomielite |
| ☐ | `parotidite.pdf` | ⏱ Parotidite infecciosa (caxumba) |
| ☐ | `peste.pdf` | ⏱ Peste |
| ☐ | `pneumoconioses.pdf` | 📅 Pneumoconioses relacionadas ao trabalho |
| ☐ | `raiva-humana.pdf` | ⏱ Raiva humana |
| ☐ | `sifilis-adquirida.pdf` | 📅 Sífilis adquirida |
| ☐ | `sifilis-congenita.pdf` | 📅 Sífilis congênita |
| ☐ | `sifilis-gestante.pdf` | 📅 Sífilis em gestante |
| ☐ | `sindrome-congenita-zika.pdf` | ⏱ Síndrome congênita associada à infecção pelo vírus Zika |
| ☐ | `srag.pdf` | ⏱ Síndrome respiratória aguda grave (SRAG) |
| ☐ | `tetano-acidental.pdf` | ⏱ Tétano acidental |
| ☐ | `tetano-neonatal.pdf` | ⏱ Tétano neonatal |
| ☐ | `toxoplasmose-congenita.pdf` | 📅 Toxoplasmose congênita e gestacional |
| ☐ | `tracoma.pdf` | 📅 Tracoma |
| ☐ | `transtornos-mentais-trabalho.pdf` | 📅 Transtornos mentais relacionados ao trabalho |
| ☐ | `tuberculose.pdf` | 📅 Tuberculose |
| ☐ | `tularemia.pdf` | ⏱ Tularemia |
| ☐ | `varicela.pdf` | ⚠ Varicela (catapora) |
| ☐ | `variola.pdf` | ⏱ Varíola |
| ☐ | `violencia-interpessoal.pdf` | ⚠ Violência interpessoal e autoprovocada |
| ☐ | `zika.pdf` | ⚠ Zika (doença aguda pelo vírus Zika) |

---

## Conferindo o resultado

```bash
node scripts/baixar-fichas.js --listar
```

Mostra quantos arquivos já estão presentes e quais ainda faltam. No próprio
sistema, cada ficha sem PDF no acervo continua funcionando: em vez do download
renomeado, abre-se a versão oficial e o comprovante avisa a ausência.
