# Kentosec Memory: Trust Boundaries

- A entrada HTTP externa entra por `packages/runtime-node` e `packages/runtime-bun`, e então se torna autoridade do framework dentro de `Application.createContext()`.
- Campos de autoridade da requisição com alto impacto de segurança: protocolo da URL, host, path, IP do cliente, corpo da requisição, alvos de redirect e cabeçalhos de resposta.
- Cabeçalhos derivados de proxy só são seguros quando existe um modelo de proxy confiável explícito e aplicado de forma consistente entre as camadas de runtime e framework.
- Parsing de body, redirects e composição de middleware são áreas primárias de revisão porque convertem entrada do usuário em dados de controle ou memória em buffer.
