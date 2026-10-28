; Instalador do Devoid Web: visual preto, minimalista, com a logo em destaque.
; Se o electron-builder acusar erro neste arquivo, apague a linha "include" em package.json > build > nsis.

!macro customHeader
  !ifndef MUI_BGCOLOR
    !define MUI_BGCOLOR "000000"
  !endif
  !ifndef MUI_TEXTCOLOR
    !define MUI_TEXTCOLOR "FFFFFF"
  !endif
  ; barra de progresso colorida (amarelo da DEBUG) sobre fundo preto
  !ifndef MUI_INSTFILESPAGE_PROGRESSBAR
    !define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
  !endif
  !ifndef MUI_INSTFILESPAGE_COLORS
    !define MUI_INSTFILESPAGE_COLORS "FACA11 000000"
  !endif
  BrandingText "Devoid Web  |  uma empresa DEBUG"
!macroend

!macro customInstall
  ; nada extra: os atalhos e o desinstalador são criados pelo electron-builder
!macroend
