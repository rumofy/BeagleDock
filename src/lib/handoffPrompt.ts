// Pedido enviado à CLI pelo atalho /handoff. Não começa com "/" para que o Claude Code
// não o trate como comando; a skill de handoff do ai-memory faz o trabalho de fato.
export const HANDOFF_PROMPT =
  "Use a skill de handoff do ai-memory (ai-memory-handoff) para salvar agora um handoff desta sessão com memory_handoff_begin: resumo do que foi feito, arquivos alterados, próximos passos e perguntas em aberto. Confirme o id do handoff criado ao final.";
