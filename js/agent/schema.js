/**
 * Esquema JSON oficial para a saida estruturada do LLM.
 * Compativel com a Gemini API (responseSchema) e validadores JSON Schema.
 */

export const ORDER_AGENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: {
      type: 'STRING',
      description: 'Ação principal que o usuário deseja executar.',
      enum: [
        'listar_cardapio',
        'adicionar_item',
        'remover_item',
        'alterar_item',
        'ver_carrinho',
        'definir_entrega',
        'confirmar_pedido',
        'cancelar_pedido',
        'tirar_duvida',
        'esclarecer_ambiguidade',
        'fora_de_escopo'
      ]
    },
    items: {
      type: 'ARRAY',
      description: 'Itens do cardápio referenciados na mensagem.',
      items: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING',
            description: 'ID exato do item conforme listado no cardápio de hoje.'
          },
          quantidade: {
            type: 'INTEGER',
            description: 'Quantidade de unidades (número inteiro positivo maior que 0).'
          },
          personalizacoes: {
            type: 'ARRAY',
            description: 'Lista de personalizações permitidas para esta unidade específica.',
            items: {
              type: 'STRING'
            }
          },
          observacoes: {
            type: 'STRING',
            description: 'Observação sanitizada e objetiva em texto livre (máximo 140 caracteres).'
          }
        },
        required: ['id']
      }
    },
    delivery: {
      type: 'OBJECT',
      description: 'Dados de entrega fornecidos pelo usuário.',
      properties: {
        bairro: {
          type: 'STRING',
          description: 'Nome do bairro ou região.'
        },
        endereco: {
          type: 'STRING',
          description: 'Logradouro completo (rua, avenida, número, complemento).'
        }
      }
    },
    termo_ambiguo: {
      type: 'STRING',
      description: 'Termo ambíguo que requer escolha do usuário (ex: "bife").'
    },
    mensagem_ao_usuario: {
      type: 'STRING',
      description: 'Mensagem cordial, breve e objetiva para o cliente em português do Brasil.'
    }
  },
  required: ['intent', 'mensagem_ao_usuario']
};
